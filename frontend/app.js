const API_BASE = "http://localhost:8080/api";
const FUNDS_CACHE_KEY = "mf_funds_cache_v1";

const form = document.getElementById("calc-form");
const fundSelect = document.getElementById("fund-select");
const errorPanel = document.getElementById("error-panel");
const resultPanel = document.getElementById("result-panel");
const submitButton = form.querySelector('button[type="submit"]');

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

function renderFunds(funds) {
  if (!Array.isArray(funds) || funds.length === 0) {
    throw new Error("No mutual funds available.");
  }

  const previousSelection = fundSelect.value;
  fundSelect.innerHTML = "";

  funds.forEach((fund) => {
    const option = document.createElement("option");
    option.value = fund.ticker;
    option.textContent = `${fund.ticker} - ${fund.name}`;
    fundSelect.appendChild(option);
  });

  if (previousSelection) {
    const hasPrevious = funds.some((fund) => fund.ticker === previousSelection);
    if (hasPrevious) {
      fundSelect.value = previousSelection;
    }
  }
}

function getCachedFunds() {
  try {
    const raw = localStorage.getItem(FUNDS_CACHE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function setCachedFunds(funds) {
  try {
    localStorage.setItem(FUNDS_CACHE_KEY, JSON.stringify(funds));
  } catch {
    // Ignore storage failures.
  }
}

function setSubmitState(isBusy, label) {
  submitButton.disabled = isBusy;
  submitButton.textContent = label;
}

async function loadFunds() {
  clearError();
  setSubmitState(true, "Loading funds...");

  const cachedFunds = getCachedFunds();
  if (cachedFunds && fundSelect.options.length === 0) {
    try {
      renderFunds(cachedFunds);
      setSubmitState(false, "Calculate Future Value");
    } catch {
      // Ignore bad cached payload.
    }
  }

  try {
    const response = await fetch(`${API_BASE}/funds`);
    if (!response.ok) {
      throw new Error("Failed to load mutual funds.");
    }

    const data = await response.json();
    renderFunds(data.funds);
    setCachedFunds(data.funds);
    setSubmitState(false, "Calculate Future Value");
  } catch (error) {
    if (fundSelect.options.length === 0) {
      fundSelect.innerHTML = '<option value="">No funds available</option>';
      setSubmitState(true, "Calculate Future Value");
    } else {
      setSubmitState(false, "Calculate Future Value");
    }
    showError((error.message || "Unable to load funds from backend.") + " Using cached values if available.");
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearError();

  const ticker = fundSelect.value;
  const principal = document.getElementById("principal").value;
  const years = document.getElementById("years").value;

  try {
    setSubmitState(true, "Calculating...");
    const params = new URLSearchParams({ ticker, principal, years });
    const response = await fetch(`${API_BASE}/investment/future-value?${params.toString()}`);
    let data = {};
    try {
      data = await response.json();
    } catch {
      // Keep default object for non-JSON failures.
    }

    if (!response.ok) {
      throw new Error(data.error || "Calculation failed.");
    }

    resultPanel.hidden = false;
    document.getElementById("future-value").textContent = toMoney(data.futureValue);
    document.getElementById("m-ticker").textContent = data.ticker;
    document.getElementById("m-risk-free").textContent = toPercent(data.riskFreeRate);
    document.getElementById("m-beta").textContent = Number(data.beta).toFixed(3);
    document.getElementById("m-expected").textContent = toPercent(data.expectedReturnRate);
    document.getElementById("m-market").textContent = toPercent(data.marketExpectedReturnRate);
    document.getElementById("m-capm").textContent = toPercent(data.capmRate);
  } catch (error) {
    resultPanel.hidden = true;
    showError(error.message || "Something went wrong while calculating.");
  } finally {
    setSubmitState(false, "Calculate Future Value");
  }
});

loadFunds();
