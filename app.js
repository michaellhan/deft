const API = location.hostname.endsWith("michael-han.com")
  ? "api/rewrite"
  : "https://www.michael-han.com/deft/api/rewrite";
const MAX_CHARS = 20000;

const $ = (id) => document.getElementById(id);
const els = {
  input: $("input"), output: $("output"), go: $("go"), status: $("status"),
  copy: $("copyBtn"), inCount: $("inCount"), outCount: $("outCount"),
};

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

const options = { thinkingLevel: "faster", optimizeFor: "human" };
let busy = false;
let result = "";

const words = (s) => (s.trim().match(/\S+/g) || []).length;

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
  const started = Date.now();
  const tick = setInterval(() => setStatus(`Rewriting… ${Math.round((Date.now() - started) / 1000)}s`), 1000);
  setStatus("Rewriting…");

  try {
    const res = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: text, ...options }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || `Something went wrong (${res.status}).`);
    showResult(data.text || "");
    setStatus(`Done in ${Math.round((Date.now() - started) / 1000)}s`);
  } catch (err) {
    showError(err.message === "Failed to fetch" ? "Couldn't reach the server. Check your connection and try again." : err.message);
    setStatus("");
  } finally {
    clearInterval(tick);
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
