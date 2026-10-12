const API = location.hostname.endsWith("michael-han.com")
  ? "api/rewrite"
  : "https://www.michael-han.com/deft/api/rewrite";
const MAX_CHARS = 20000;

const $ = (id) => document.getElementById(id);
const els = {
  input: $("input"), output: $("output"), go: $("go"), status: $("status"),
  copy: $("copyBtn"), inCount: $("inCount"), outCount: $("outCount"),
  progress: $("progress"), fill: $("progressFill"),
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

function showResult(text) {
  result = text;
  els.output.className = "output";
  els.output.textContent = text;
  els.copy.disabled = false;
  els.outCount.hidden = false;
  els.outCount.textContent = `${words(text)} words`;
}

// Segmented controls
document.querySelectorAll(".seg button").forEach((btn) => {
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
  document.querySelectorAll(".seg button").forEach((b) => {
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

async function run() {
  if (busy) return;
  const text = els.input.value.trim();
  if (!text) { els.input.focus(); setStatus("Paste some text first."); return; }
  if (text.length > MAX_CHARS) { setStatus(`Keep it under ${MAX_CHARS.toLocaleString()} characters.`, true); return; }

  busy = true;
  els.go.disabled = true;
  els.copy.disabled = true;
  els.outCount.hidden = true;
  showLoading();
  const est = estimateSeconds(words(text));
  const started = Date.now();
  els.progress.hidden = false;
  els.progress.classList.remove("done");
  els.fill.style.transition = "none";
  els.fill.style.width = "0";
  void els.fill.offsetWidth;
  els.fill.style.transition = "";
  const update = () => {
    const elapsed = (Date.now() - started) / 1000;
    els.fill.style.width = `${progressAt(elapsed, est) * 100}%`;
    setStatus(`Rewriting… ${elapsed < est ? fmtLeft(est - elapsed) : "taking a little longer"}`);
  };
  update();
  const tick = setInterval(update, 250);

  try {
    const res = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: text, ...options }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || `Something went wrong (${res.status}).`);
    const took = (Date.now() - started) / 1000;
    learn(est, took);
    showResult(data.text || "");
    setStatus(`Done in ${Math.round(took)}s`);
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
