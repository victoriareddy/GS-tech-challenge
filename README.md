# Mutual Fund Calculator - Technical Challenge Solution

This repository contains a complete full-stack implementation of the **2026 Engineering ELS Technical Challenge**.

## What is included

- Java backend with REST APIs
- Frontend web UI for selecting a mutual fund and calculating projected value
- CAPM-based future value calculation using live market inputs
- One-command start/stop scripts (`start.sh`, `stop.sh`)

## Backend APIs

Base URL: `http://localhost:8080`

- `GET /api/health`
- `GET /api/funds`
- `GET /api/investment/future-value?ticker=VFIAX&principal=10000&years=5`

### Formula used

- `r = riskFreeRate + beta * (expectedReturnRate - riskFreeRate)`
- `futureValue = principal * (1 + r)^years`

Where:

- `riskFreeRate` comes from the latest available [FRED `DGS10` series](https://fred.stlouisfed.org/series/DGS10) value (10-year Treasury, converted from percent to decimal), with a fallback default of `0.043` if FRED is temporarily unavailable
- `beta` comes from the [Newton Analytics stock beta API](https://www.newtonanalytics.com/docs/api/stockbeta.php)
- `expectedReturnRate` is the selected fund's 1-year average annualized return, computed from [Yahoo Finance chart API (example)](https://query1.finance.yahoo.com/v8/finance/chart/VFIAX?range=1y&interval=1mo&events=history) monthly close data
- `marketExpectedReturnRate` is the S&P 500 (`^GSPC`) 5-year average annualized return, computed from [Yahoo Finance S&P 500 chart API](https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC?range=5y&interval=1mo&events=history) monthly close data

## Project structure

- `backend/src/MutualFundCalculatorServer.java`
- `frontend/index.html`
- `frontend/styles.css`
- `frontend/app.js`

## Run instructions

### 1) Start everything with one command

```bash
./start.sh
```

This starts:
- Backend on `http://localhost:8080`
- Frontend static server on `http://localhost:5500`

### 2) Open frontend

- `http://localhost:5500/frontend/index.html`

### 3) Stop everything

```bash
./stop.sh
```

Notes:
- `start.sh` also cleans up on `Ctrl+C` when run in the foreground.
- If you use custom ports:

```bash
BACKEND_PORT=8080 FRONTEND_PORT=5500 ./stop.sh
```

### FRED diagnostics (if risk-free rate falls back)

Run:

```bash
./fred_diagnose.sh
```

Optional: set `FRED_API_KEY` to use the official FRED API endpoint:

```bash
export FRED_API_KEY=your_key_here
./start.sh
```

## Notes and assumptions

- Mutual funds are hardcoded and exposed through `/api/funds`, with ETF support included as a bonus extension.
- The backend validates ticker, principal, and years.
- External market APIs can fail or rate-limit; backend returns `502` with a clear error payload in those cases.
- CORS is enabled for local development (`Access-Control-Allow-Origin: *`).

## Bonus-ready extensions

- JUnit tests for API handlers and formula service
- Historical graph visualization in frontend
- Multi-fund comparison mode
- Persist calculations in a SQL database and display investment history
