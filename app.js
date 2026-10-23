const API = location.hostname.endsWith("michael-han.com")
  ? "api/rewrite"
  : "https://www.michael-han.com/deft/api/rewrite";
const MAX_CHARS = 20000;
const LIMIT_RANGE = [10, 5000];

const $ = (id) => document.getElementById(id);
const els = {
  input: $("input"), output: $("output"), go: $("go"), status: $("status"),
  copy: $("copyBtn"), inCount: $("inCount"), outCount: $("outCount"),
  progress: $("progress"), fill: $("progressFill"), limit: $("limit"), noLimit: $("noLimit"),
};

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

const options = { thinkingLevel: "faster", optimizeFor: "human" };
let busy = false;
let result = "";

const words = (s) => (s.trim().match(/\S+/g) || []).length;

// Rewrite time model, fit from measured Deft API timings (seconds).
const TIMING = {
  faster: { base: 12, perWord: 0.14 },
  smarter: { base: 14, perWord: 0.13 },
  polished: 0.7,
};
function estimateSeconds(n) {
  const t = TIMING[options.thinkingLevel === "smarter" ? "smarter" : "faster"];
  const base = t.base + t.perWord * n;
  const mult = options.optimizeFor === "polished" ? TIMING.polished : 1;
  // Per-browser correction learned from this viewer's past runs.
  const k = Number(store.get("deft:speed")) || 1;
  return Math.max(4, base * mult * k);
}
function learn(estimate, actual) {
  const k = Number(store.get("deft:speed")) || 1;
  const ratio = Math.min(3, Math.max(0.33, actual / (estimate / k)));
  store.set("deft:speed", String(k * 0.7 + ratio * 0.3));
}

// Fills linearly to 90% by the estimate, then creeps toward 99% so it never stalls or lies.
function progressAt(elapsed, est) {
  if (elapsed <= est) return 0.9 * (elapsed / est);
  return 0.99 - 0.09 * Math.exp(-(elapsed - est) / (est * 0.5));
}
function fmtLeft(sec) {
  if (sec <= 2) return "almost done";
  if (sec < 60) return `about ${Math.ceil(sec / 5) * 5}s left`;
  return `about ${Math.round(sec / 60)} min left`;
}

function setStatus(msg, err = false) {
  els.status.textContent = msg;
  els.status.classList.toggle("err", err);
}

function showPlaceholder() {
  els.output.className = "output empty";
  els.output.innerHTML = '<span class="placeholder">The rewrite appears here.</span>';
}

function showLoading() {
  els.output.className = "output loading";
  els.output.innerHTML = [92, 100, 84, 96, 60].map((w) => `<div class="shimmer" style="width:${w}%"></div>`).join("");
}

function showError(msg) {
  els.output.className = "output";
  els.output.innerHTML = "";
  const p = document.createElement("p");
  p.className = "error";
  p.textContent = msg;
  els.output.append(p);
}

function showResult(text, limit) {
  result = text;
  els.output.className = "output";
  els.output.textContent = text;
  els.copy.disabled = false;
  els.outCount.hidden = false;
  els.outCount.textContent = limit ? `${words(text)} / ${limit} words` : `${words(text)} words`;
}

function readLimit() {
  const raw = els.limit.value.trim();
  if (!raw) return null;
  const n = Math.round(Number(raw));
  return Number.isFinite(n) && n >= LIMIT_RANGE[0] && n <= LIMIT_RANGE[1] ? n : NaN;
}

// Segmented controls
document.querySelectorAll(".seg button[data-group]").forEach((btn) => {
  const { group, value } = btn.dataset;
  const saved = store.get(`deft:${group}`);
  if (saved) options[group] = saved;
  btn.addEventListener("click", () => {
    options[group] = value;
    store.set(`deft:${group}`, value);
    syncSeg();
  });
});
function syncSeg() {
  document.querySelectorAll(".seg button[data-group]").forEach((b) => {
    b.setAttribute("aria-checked", String(options[b.dataset.group] === b.dataset.value));
  });
}
syncSeg();

els.input.value = store.get("deft:draft") || "";
const onInput = () => {
  els.inCount.textContent = words(els.input.value);
  store.set("deft:draft", els.input.value);
};
els.input.addEventListener("input", onInput);
onInput();

els.limit.value = store.get("deft:limit") || "";
const syncLimit = () => {
  const on = els.limit.value.trim() !== "";
  els.limit.closest(".limit-field").classList.toggle("on", on);
  // Fit the field to its digits so "250 words" reads as one label.
  els.limit.style.width = on ? `${Math.max(2, els.limit.value.length) + 0.4}ch` : "";
  els.noLimit.setAttribute("aria-pressed", String(!on));
};
els.limit.addEventListener("input", () => { store.set("deft:limit", els.limit.value.trim()); syncLimit(); });
els.noLimit.addEventListener("click", () => {
  els.limit.value = "";
  store.set("deft:limit", "");
  syncLimit();
});
syncLimit();

// Reads the worker's NDJSON stream, calling onEvent for each line.
async function readEvents(res, onEvent) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    buf += dec.decode(value || new Uint8Array(), { stream: !done });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) onEvent(JSON.parse(line));
    }
    if (done) break;
  }
}

async function run() {
  if (busy) return;
  const text = els.input.value.trim();
  if (!text) { els.input.focus(); setStatus("Paste some text first."); return; }
  if (text.length > MAX_CHARS) { setStatus(`Keep it under ${MAX_CHARS.toLocaleString()} characters.`, true); return; }

  const limit = readLimit();
  if (Number.isNaN(limit)) {
    els.limit.focus();
    setStatus(`Word limit must be between ${LIMIT_RANGE[0]} and ${LIMIT_RANGE[1].toLocaleString()}.`, true);
    return;
  }

  busy = true;
  els.go.disabled = true;
  els.copy.disabled = true;
  els.outCount.hidden = true;
  showLoading();
  const started = Date.now();
  els.progress.hidden = false;
  els.progress.classList.remove("done");

  // The bar restarts for each pass; later passes tighten the previous output.
  let pass = { n: 1, of: 1, est: estimateSeconds(words(text)), started, label: "Rewriting" };
  const resetBar = () => {
    els.fill.style.transition = "none";
    els.fill.style.width = "0";
    void els.fill.offsetWidth;
    els.fill.style.transition = "";
  };
  resetBar();
  const update = () => {
    const elapsed = (Date.now() - pass.started) / 1000;
    els.fill.style.width = `${progressAt(elapsed, pass.est) * 100}%`;
    const step = pass.of > 1 ? ` (pass ${pass.n})` : "";
    setStatus(`${pass.label}${step}… ${elapsed < pass.est ? fmtLeft(pass.est - elapsed) : "taking a little longer"}`);
  };
  update();
  const tick = setInterval(update, 250);

  try {
    const res = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: text, ...options, ...(limit && { wordLimit: limit }) }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || `Something went wrong (${res.status}).`);
    }
    let final = null;
    let passes = 0;
    await readEvents(res, (ev) => {
      if (ev.type === "pass") {
        if (ev.pass > 1) {
          if (ev.stage === "shorten") learn(pass.est, (Date.now() - pass.started) / 1000);
          const label = ev.stage === "shorten" ? `Shortening ${ev.words} → ${ev.limit} words` : "Rewriting the shorter draft";
          pass = { n: ev.pass, of: ev.of, est: estimateSeconds(ev.words), started: Date.now(), label };
          resetBar();
          update();
        } else {
          pass.of = ev.of;
        }
        passes = ev.pass;
      } else if (ev.type === "done") {
        final = ev;
      } else if (ev.type === "error") {
        throw new Error(ev.message);
      }
    });
    if (!final) throw new Error("The rewrite stopped partway. Try again.");
    if (passes === 1) learn(pass.est, (Date.now() - pass.started) / 1000);
    const took = Math.round((Date.now() - started) / 1000);
    showResult(final.text, final.limit);
    const extra = passes > 1 ? ` · ${passes} passes` : "";
    setStatus(final.over
      ? `Done in ${took}s${extra}. Still ${final.over} words over the limit.`
      : `Done in ${took}s${extra}`);
  } catch (err) {
    showError(err.message === "Failed to fetch" ? "Couldn't reach the server. Check your connection and try again." : err.message);
    setStatus("");
  } finally {
    clearInterval(tick);
    els.fill.style.width = "100%";
    els.progress.classList.add("done");
    setTimeout(() => { if (!busy) els.progress.hidden = true; }, 450);
    busy = false;
    els.go.disabled = false;
  }
}

els.go.addEventListener("click", run);
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); run(); }
});

els.copy.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(result);
    els.copy.textContent = "Copied";
    setTimeout(() => (els.copy.textContent = "Copy"), 1400);
  } catch {
    setStatus("Couldn't copy. Select the text instead.", true);
  }
});
