// Proxies rewrite requests to the Deft API so the key never reaches the browser.
const DEFT_URL = "https://deftwriting.com/v1/generate";
const MAX_CHARS = 20000;
const MIN_LIMIT = 10;
const MAX_LIMIT = 5000;
// Rewrites per request when a word limit is set; each pass after the first is preceded by a shortening call.
const MAX_PASSES = 3;
const ALLOWED_ORIGIN = /^https:\/\/(www\.)?michael-han\.com$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const CHOICES = {
  thinkingLevel: ["faster", "smarter"],
  optimizeFor: ["human", "polished"],
};

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin") || "";
    const cors = ALLOWED_ORIGIN.test(origin)
      ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "POST", Vary: "Origin" }
      : {};
    const json = (body, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors } });

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST") return json({ message: "Method not allowed." }, 405);
    if (!ALLOWED_ORIGIN.test(origin)) return json({ message: "Forbidden." }, 403);

    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const { success } = await env.LIMITER.limit({ key: ip });
    if (!success) return json({ message: "Too many requests. Wait a minute and try again." }, 429);

    let body;
    try { body = await request.json(); } catch { return json({ message: "Invalid request." }, 400); }

    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    if (!prompt) return json({ message: "Paste some text first." }, 400);
    if (prompt.length > MAX_CHARS) return json({ message: `Keep it under ${MAX_CHARS.toLocaleString()} characters.` }, 400);

    const pick = (k) => (CHOICES[k].includes(body[k]) ? body[k] : CHOICES[k][0]);
    const base = { generationMode: "rewrite", thinkingLevel: pick("thinkingLevel"), optimizeFor: pick("optimizeFor") };
    const limit = Number.isInteger(body.wordLimit) && body.wordLimit >= MIN_LIMIT && body.wordLimit <= MAX_LIMIT ? body.wordLimit : null;

    // Streams NDJSON events: {type:"pass"} as each step starts, then {type:"done"} or {type:"error"}.
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const enc = new TextEncoder();
    const send = (event) => writer.write(enc.encode(JSON.stringify(event) + "\n")).catch(() => {});
    // Keeps the connection alive while Deft works.
    const ping = setInterval(() => send({ type: "ping" }), 15000);

    const work = (async () => {
      try {
        // Deft's rewrite mode takes no instructions, so over-limit text is shortened with
        // Deft's strict generate mode and then rewritten again. The final text is always a rewrite.
        let draft = prompt;
        let best = null;
        const passes = limit ? MAX_PASSES : 1;
        for (let pass = 1; pass <= passes; pass++) {
          if (pass > 1) {
            const target = Math.floor(limit * (pass === 2 ? 0.85 : 0.75));
            send({ type: "pass", pass, of: passes, stage: "shorten", words: words(draft), limit });
            const short = await deft(env, { generationMode: "simple", detailMode: "strict", prompt: shortenPrompt(draft, target) });
            if (short.error || !short.text.trim()) break;
            draft = short.text;
          }
          send({ type: "pass", pass, of: passes, stage: "rewrite", words: words(draft), limit });
          const r = await deft(env, { ...base, prompt: draft });
          if (r.error) {
            // Keep a usable earlier pass rather than failing the whole run.
            if (best) break;
            send({ type: "error", message: r.error });
            return;
          }
          const n = words(r.text);
          if (!best || n < best.words) best = { text: r.text, words: n };
          if (!limit || n <= limit) break;
          draft = r.text;
        }
        send({ type: "done", text: best.text, words: best.words, limit, over: limit ? Math.max(0, best.words - limit) : 0 });
      } finally {
        clearInterval(ping);
        writer.close().catch(() => {});
      }
    })();
    ctx.waitUntil(work);

    return new Response(readable, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store", ...cors } });
  },
};

const words = (s) => (s.trim().match(/\S+/g) || []).length;

function shortenPrompt(text, target) {
  return `Shorten the text below to between ${Math.floor(target * 0.8)} and ${target} words. Keep its main points, facts, and voice. Drop filler, repetition, and minor details, and merge ideas where you can. Return only the shortened text, with no title, headings, or commentary.\n\n---\n\n${text}`;
}

async function deft(env, payload) {
  let res;
  try {
    res = await fetch(DEFT_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.DEFT_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    return { error: "Couldn't reach Deft. Try again in a moment." };
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.log("deft error", res.status, JSON.stringify(data));
    return {
      error: {
        429: "Deft is rate limiting right now. Try again in a minute.",
        402: "The rewrite service is out of credit right now.",
      }[res.status] || "The rewrite failed. Try again in a moment.",
    };
  }
  return { text: data.text || "" };
}
