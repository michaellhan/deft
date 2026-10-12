// Proxies rewrite requests to the Deft API so the key never reaches the browser.
const DEFT_URL = "https://deftwriting.com/v1/generate";
const MAX_CHARS = 20000;
const ALLOWED_ORIGIN = /^https:\/\/(www\.)?michael-han\.com$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const CHOICES = {
  thinkingLevel: ["faster", "smarter"],
  optimizeFor: ["human", "polished"],
};

export default {
  async fetch(request, env) {
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
    const payload = {
      generationMode: "rewrite",
      prompt,
      thinkingLevel: pick("thinkingLevel"),
      optimizeFor: pick("optimizeFor"),
    };

    let res;
    try {
      res = await fetch(DEFT_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${env.DEFT_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch {
      return json({ message: "Couldn't reach Deft. Try again in a moment." }, 502);
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.log("deft error", res.status, JSON.stringify(data));
      const msg = {
        429: "Deft is rate limiting right now. Try again in a minute.",
        402: "The rewrite service is out of credit right now.",
      }[res.status] || "The rewrite failed. Try again in a moment.";
      return json({ message: msg }, res.status === 429 ? 429 : 502);
    }
    return json({ text: data.text || "" });
  },
};
