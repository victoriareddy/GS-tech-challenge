# Mutual Fund Calculator - Technical Challenge Solution

This repository contains a complete full-stack implementation of the **2026 Engineering ELS Technical Challenge**.

## What is included

- Java backend with REST APIs
- Frontend web UI for selecting a mutual fund and calculating projected value
- CAPM-based future value calculation using live market inputs

## Backend APIs

Base URL: `http://localhost:8080`

- `GET /api/health`
- `GET /api/funds`
- `GET /api/investment/future-value?ticker=VFIAX&principal=10000&years=5`

### Formula used

- `r = riskFreeRate + beta * (expectedReturnRate - riskFreeRate)`
- `futureValue = principal * (1 + r)^years`

Where:

- `riskFreeRate` is hardcoded to `0.043` (4.30%)
- `beta` comes from Newton Analytics stock beta API
- `expectedReturnRate` is estimated from Yahoo Finance 1-year monthly close data:
  - `(lastClose - firstClose) / firstClose`

## Project structure

- `backend/src/MutualFundCalculatorServer.java`
- `frontend/index.html`
- `frontend/styles.css`
- `frontend/app.js`

## Run instructions

### 1) Start backend

```bash
cd backend
javac -d bin src/MutualFundCalculatorServer.java
java -cp bin MutualFundCalculatorServer
```

Backend starts on `http://localhost:8080`.

### 2) Open frontend

Open `frontend/index.html` in your browser.

If your browser blocks local-file fetches, run a simple local static server from repository root:

```bash
python3 -m http.server 5500
```

Then open:

- `http://localhost:5500/frontend/index.html`

## Notes and assumptions

- Mutual funds are hardcoded and exposed through `/api/funds`.
- The backend validates ticker, principal, and years.
- External market APIs can fail or rate-limit; backend returns `502` with a clear error payload in those cases.
- CORS is enabled for local development (`Access-Control-Allow-Origin: *`).

## Bonus-ready extensions

- JUnit tests for API handlers and formula service
- Historical graph visualization in frontend
- Multi-fund comparison mode
- Persist calculations in a SQL database and display investment history
