const API_BASE = "http://localhost:8080/api";

const form = document.getElementById("calc-form");
const fundSelect = document.getElementById("fund-select");
const errorPanel = document.getElementById("error-panel");
const resultPanel = document.getElementById("result-panel");

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

async function loadFunds() {
  clearError();
  try {
    const response = await fetch(`${API_BASE}/funds`);
    if (!response.ok) {
      throw new Error("Failed to load mutual funds.");
    }

    const data = await response.json();
    fundSelect.innerHTML = "";
    data.funds.forEach((fund) => {
      const option = document.createElement("option");
      option.value = fund.ticker;
      option.textContent = `${fund.ticker} - ${fund.name}`;
      fundSelect.appendChild(option);
    });
  } catch (error) {
    showError(error.message || "Unable to load funds from backend.");
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearError();

  const ticker = fundSelect.value;
  const principal = document.getElementById("principal").value;
  const years = document.getElementById("years").value;

  try {
    const params = new URLSearchParams({ ticker, principal, years });
    const response = await fetch(`${API_BASE}/investment/future-value?${params.toString()}`);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Calculation failed.");
    }

    resultPanel.hidden = false;
    document.getElementById("future-value").textContent = toMoney(data.futureValue);
    document.getElementById("m-ticker").textContent = data.ticker;
    document.getElementById("m-risk-free").textContent = toPercent(data.riskFreeRate);
    document.getElementById("m-beta").textContent = Number(data.beta).toFixed(3);
    document.getElementById("m-expected").textContent = toPercent(data.expectedReturnRate);
    document.getElementById("m-capm").textContent = toPercent(data.capmRate);
  } catch (error) {
    resultPanel.hidden = true;
    showError(error.message || "Something went wrong while calculating.");
  }
});

loadFunds();
