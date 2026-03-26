const API_BASE = `${window.location.protocol}//${window.location.hostname}:8080/api`;
const FUNDS_CACHE_KEY = "mf_funds_cache_v1";

const form        = document.getElementById("calc-form");
const fundSelect  = document.getElementById("fund-select");
const errorPanel  = document.getElementById("error-panel");
const resultPanel = document.getElementById("result-panel");
const submitBtn   = form.querySelector('button[type="submit"]');

// ── Helpers ───────────────────────────────────────────────────────────────────

function showError(message) {
  errorPanel.textContent = message;
  errorPanel.hidden = false;
}

function clearError() {
  errorPanel.hidden = true;
  errorPanel.textContent = "";
}

function toPercent(value) {
  return `${(Number(value) * 100).toFixed(2)}%`;
}

function toMoney(value) {
  return Number(value).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

function setSubmitState(busy, label) {
  submitBtn.disabled = busy;
  submitBtn.textContent = label;
}

// ── Fund dropdown ─────────────────────────────────────────────────────────────

function renderFunds(funds) {
  if (!Array.isArray(funds) || funds.length === 0) {
    throw new Error("No mutual funds available.");
  }

  const prev = fundSelect.value;
  fundSelect.innerHTML = "";

  // Group by category using <optgroup>
  const categories = [...new Set(funds.map(f => f.category).filter(Boolean))];
  if (categories.length > 0) {
    categories.forEach(cat => {
      const group = document.createElement("optgroup");
      group.label = cat;
      funds
        .filter(f => f.category === cat)
        .forEach(f => {
          const opt = document.createElement("option");
          opt.value = f.ticker;
          opt.textContent = `${f.ticker} — ${f.name}`;
          group.appendChild(opt);
        });
      fundSelect.appendChild(group);
    });
  } else {
    funds.forEach(f => {
      const opt = document.createElement("option");
      opt.value = f.ticker;
      opt.textContent = `${f.ticker} — ${f.name}`;
      fundSelect.appendChild(opt);
    });
  }

  // Restore previous selection
  if (prev && funds.some(f => f.ticker === prev)) fundSelect.value = prev;
}

function getCachedFunds() {
  try {
    const raw = localStorage.getItem(FUNDS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch { return null; }
}

function setCachedFunds(funds) {
  try { localStorage.setItem(FUNDS_CACHE_KEY, JSON.stringify(funds)); } catch { /* ignore */ }
}

async function loadFunds() {
  clearError();
  setSubmitState(true, "Loading funds…");

  // Show cached funds immediately while fetch runs in background
  const cached = getCachedFunds();
  if (cached && fundSelect.options.length === 0) {
    try { renderFunds(cached); setSubmitState(false, "Calculate Future Value →"); } catch { /* ignore */ }
  }

  try {
    const res = await fetch(`${API_BASE}/funds`);
    if (!res.ok) throw new Error("Failed to load supported funds and ETFs.");
    const data = await res.json();
    renderFunds(data.funds);
    setCachedFunds(data.funds);
    setSubmitState(false, "Calculate Future Value →");
  } catch (err) {
    if (fundSelect.options.length === 0) {
      fundSelect.innerHTML = '<option value="">No funds available</option>';
      setSubmitState(true, "Calculate Future Value →");
    } else {
      setSubmitState(false, "Calculate Future Value →");
    }
    showError(`${err.message || "Unable to load funds."} Make sure the server is running on port 8080.`);
  }
}

// ── Form submit → CAPM calculation ───────────────────────────────────────────

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearError();

  const ticker    = fundSelect.value;
  const principal = document.getElementById("principal").value;
  const years     = document.getElementById("years").value;

  if (!ticker) { showError("Please select a fund or ETF."); return; }

  try {
    setSubmitState(true, "Fetching live data & calculating…");

    const params = new URLSearchParams({ ticker, principal, years });
    const res    = await fetch(`${API_BASE}/investment/future-value?${params}`);

    let data = {};
    try { data = await res.json(); } catch { /* keep default */ }
    if (!res.ok) throw new Error(data.error || "Calculation failed.");

    // ── Populate result panel ──────────────────────────────────────────────
    resultPanel.hidden = false;

    document.getElementById("future-value").textContent = toMoney(data.futureValue);
    document.getElementById("m-ticker").textContent     = data.ticker;
    document.getElementById("m-risk-free").textContent  = toPercent(data.riskFreeRate);
    document.getElementById("m-beta").textContent       = Number(data.beta).toFixed(3);
    document.getElementById("m-expected").textContent   = toPercent(data.expectedReturnRate);
    document.getElementById("m-market").textContent     = toPercent(data.marketExpectedReturnRate);
    document.getElementById("m-capm").textContent       = toPercent(data.capmRate);

    // Show data source badges if the server returned them
    if (data.sources) {
      setSourceBadge("badge-beta",   data.sources.beta);
      setSourceBadge("badge-return", data.sources.expectedReturn);
      setSourceBadge("badge-rf",     data.sources.riskFreeRate);
    }

    resultPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });

  } catch (err) {
    resultPanel.hidden = true;
    showError(err.message || "Something went wrong while calculating.");
  } finally {
    setSubmitState(false, "Calculate Future Value →");
  }
});

function setSourceBadge(id, text) {
  const el = document.getElementById(id);
  if (!el || !text) return;
  const isLive = text.toLowerCase().includes("live") || text.toLowerCase().includes("newton") || text.toLowerCase().includes("yahoo");
  el.textContent = isLive ? "⚡ Live" : "📦 Cached";
  el.className   = "source-badge " + (isLive ? "live" : "cached");
  el.title       = text;
  el.hidden      = false;
}

loadFunds();
