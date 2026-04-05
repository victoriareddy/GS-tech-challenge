/**
 * Mutual Fund Calculator Backend
 * ──────────────────────────────────────────
 * Stack  : Node.js + Express
 * Spec   : Goldman Sachs Tech Challenge — Mutual Fund Calculator
 *
 * Endpoints:
 *   GET  /api/funds                          → list of hardcoded mutual funds/ETFs
 *   GET  /api/investment/future-value        → CAPM future value calculation
 *   POST /api/chat                           → Gemini AI advisor (context-aware)
 *   GET  /api/health                         → health check
 *
 * CAPM formula (per spec):
 *   r = riskFreeRate + beta × (expectedReturnRate − riskFreeRate)
 *   FV = principal × (1 + r)^years
 *
 * Setup:
 *   1. npm install express cors dotenv @google/generative-ai node-fetch
 *   2. Create ../.env (repo root):  GEMINI_API_KEY=your-key-here
 *   3. node server.js
 */

const express  = require('express');
const cors     = require('cors');
const path     = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

let _fetch;
async function getFetch() {
  if (_fetch) return _fetch;
  try {
    if (typeof fetch !== 'undefined') { _fetch = fetch; return _fetch; }
    _fetch = (await import('node-fetch')).default;
  } catch {
    const nf = require('node-fetch');
    _fetch = nf.default ?? nf;
  }
  return _fetch;
}

const { GoogleGenerativeAI } = require('@google/generative-ai');

// ── Config ─────────────────────────────────────────────────────────────────────
const PORT       = process.env.PORT         || 3000;
const MODEL      = process.env.GEMINI_MODEL || 'gemini-1.5-flash-latest';
const MAX_TOKENS = parseInt(process.env.MAX_TOKENS || '1024', 10);

if (!process.env.GEMINI_API_KEY) {
  console.error('❌  GEMINI_API_KEY is missing. Add it to a .env file and restart.');
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ── CAPM Constants ─────────────────────────────────────────────────────────────
const RISK_FREE_RATE         = 0.0425; // ~US 10-yr Treasury (FRED DGS10)
const MARKET_EXPECTED_RETURN = 0.1050; // S&P 500 5-year historical avg

const NEWTON_BASE = 'https://api.newtonanalytics.com';
const YAHOO_BASE  = 'https://query1.finance.yahoo.com/v8/finance/chart';

// ── Hardcoded Fund List ────────────────────────────────────────────────────────
const FUNDS = [
  { ticker: 'VFIAX', name: 'Vanguard 500 Index Fund Admiral',          category: 'Broad Market'  },
  { ticker: 'FXAIX', name: 'Fidelity 500 Index Fund',                  category: 'Broad Market'  },
  { ticker: 'VTSAX', name: 'Vanguard Total Stock Market Index Admiral', category: 'Broad Market'  },
  { ticker: 'FSKAX', name: 'Fidelity Total Market Index Fund',          category: 'Broad Market'  },
  { ticker: 'SWPPX', name: 'Schwab S&P 500 Index Fund',                 category: 'Broad Market'  },
  { ticker: 'AGTHX', name: 'American Funds Growth Fund of America A',   category: 'Growth'        },
  { ticker: 'AIVSX', name: 'American Funds Investment Co of America A', category: 'Value'         },
  { ticker: 'AWSHX', name: 'American Funds Washington Mutual A',        category: 'Value'         },
  { ticker: 'ANWPX', name: 'American Funds New Perspective A',          category: 'International' },
  { ticker: 'NEWFX', name: 'American Funds New World A',                category: 'Emerging Mkt'  },
  { ticker: 'FCNTX', name: 'Fidelity Contrafund',                       category: 'Growth'        },
  { ticker: 'FDGRX', name: 'Fidelity Growth Company Fund',              category: 'Growth'        },
  { ticker: 'TRBCX', name: 'T. Rowe Price Blue Chip Growth Fund',       category: 'Growth'        },
  { ticker: 'PRGFX', name: 'T. Rowe Price Growth Stock Fund',           category: 'Growth'        },
  { ticker: 'DODFX', name: 'Dodge & Cox International Stock Fund',      category: 'International' },
  { ticker: 'DODGX', name: 'Dodge & Cox Stock Fund',                    category: 'Value'         },
  { ticker: 'VWELX', name: 'Vanguard Wellington Fund Admiral',          category: 'Balanced'      },
  { ticker: 'VWINX', name: 'Vanguard Wellesley Income Fund Admiral',    category: 'Balanced'      },
  { ticker: 'VBTLX', name: 'Vanguard Total Bond Market Index Admiral',  category: 'Bond'          },
  { ticker: 'PTTRX', name: 'PIMCO Total Return Fund Institutional',     category: 'Bond'          },
  { ticker: 'VOO',   name: 'Vanguard S&P 500 ETF',                      category: 'ETF'           },
  { ticker: 'SPY',   name: 'SPDR S&P 500 ETF Trust',                    category: 'ETF'           },
  { ticker: 'QQQ',   name: 'Invesco QQQ Trust (Nasdaq-100)',             category: 'ETF'           },
  { ticker: 'VTI',   name: 'Vanguard Total Stock Market ETF',           category: 'ETF'           },
  { ticker: 'IVV',   name: 'iShares Core S&P 500 ETF',                  category: 'ETF'           },
];

// ── Live Data Helpers ──────────────────────────────────────────────────────────

async function fetchBeta(ticker) {
  const fetch = await getFetch();
  const url = `${NEWTON_BASE}/stock-beta/?ticker=${encodeURIComponent(ticker)}&index=%5EGSPC&interval=1mo&observations=12`;
  const res = await fetch(url, { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Newton API returned ${res.status} for ${ticker}`);
  const data = await res.json();
  const beta = parseFloat(data?.data ?? data?.beta ?? data);
  if (isNaN(beta)) throw new Error(`Could not parse beta from Newton response: ${JSON.stringify(data)}`);
  return beta;
}

async function fetchExpectedReturn(ticker) {
  const fetch    = await getFetch();
  const now      = Math.floor(Date.now() / 1000);
  const oneYrAgo = now - 365 * 24 * 3600;
  const url      = `${YAHOO_BASE}/${encodeURIComponent(ticker)}?period1=${oneYrAgo}&period2=${now}&interval=1d&events=history`;
  const res      = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Yahoo Finance returned ${res.status} for ${ticker}`);
  const json   = await res.json();
  const closes = json?.chart?.result?.[0]?.indicators?.quote?.[0]?.close;
  if (!Array.isArray(closes) || closes.length < 2) throw new Error(`Insufficient price history for ${ticker}`);
  const prices = closes.filter(p => p != null && !isNaN(p));
  if (prices.length < 2) throw new Error(`Not enough valid prices for ${ticker}`);
  return (prices[prices.length - 1] - prices[0]) / prices[0];
}

const FALLBACK = {
  VFIAX: { beta: 1.00, expectedReturnRate: 0.132 },
  FXAIX: { beta: 1.00, expectedReturnRate: 0.132 },
  VTSAX: { beta: 1.02, expectedReturnRate: 0.134 },
  FSKAX: { beta: 1.01, expectedReturnRate: 0.133 },
  SWPPX: { beta: 1.00, expectedReturnRate: 0.131 },
  AGTHX: { beta: 1.10, expectedReturnRate: 0.148 },
  AIVSX: { beta: 0.92, expectedReturnRate: 0.108 },
  AWSHX: { beta: 0.88, expectedReturnRate: 0.104 },
  ANWPX: { beta: 0.95, expectedReturnRate: 0.098 },
  NEWFX: { beta: 1.05, expectedReturnRate: 0.090 },
  FCNTX: { beta: 1.08, expectedReturnRate: 0.155 },
  FDGRX: { beta: 1.15, expectedReturnRate: 0.168 },
  TRBCX: { beta: 1.12, expectedReturnRate: 0.160 },
  PRGFX: { beta: 1.10, expectedReturnRate: 0.155 },
  DODFX: { beta: 0.90, expectedReturnRate: 0.092 },
  DODGX: { beta: 0.95, expectedReturnRate: 0.112 },
  VWELX: { beta: 0.65, expectedReturnRate: 0.090 },
  VWINX: { beta: 0.40, expectedReturnRate: 0.072 },
  VBTLX: { beta: 0.04, expectedReturnRate: 0.041 },
  PTTRX: { beta: 0.06, expectedReturnRate: 0.043 },
  VOO:   { beta: 1.00, expectedReturnRate: 0.132 },
  SPY:   { beta: 1.00, expectedReturnRate: 0.131 },
  QQQ:   { beta: 1.18, expectedReturnRate: 0.178 },
  VTI:   { beta: 1.02, expectedReturnRate: 0.134 },
  IVV:   { beta: 1.00, expectedReturnRate: 0.132 },
};

// ── Express App ────────────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname)));

// ── GET /api/funds ─────────────────────────────────────────────────────────────
app.get('/api/funds', (_req, res) => {
  res.json({ funds: FUNDS });
});

// ── GET /api/investment/future-value ──────────────────────────────────────────
app.get('/api/investment/future-value', async (req, res) => {
  const { ticker, principal, years } = req.query;

  if (!ticker || !principal || !years) {
    return res.status(400).json({ error: 'ticker, principal, and years are required query parameters.' });
  }

  const t    = ticker.toUpperCase();
  const fund = FUNDS.find(f => f.ticker === t);
  if (!fund) {
    return res.status(404).json({ error: `Fund "${ticker}" not found. Call /api/funds for the list.` });
  }

  const p = parseFloat(principal);
  const y = parseFloat(years);
  if (isNaN(p) || p <= 0) return res.status(400).json({ error: 'principal must be a positive number.' });
  if (isNaN(y) || y <= 0) return res.status(400).json({ error: 'years must be a positive number.' });

  const fallback = FALLBACK[t] ?? { beta: 1.0, expectedReturnRate: 0.10 };
  let beta, expectedReturnRate, betaSource, returnSource;

  try {
    beta       = await fetchBeta(t);
    betaSource = 'Newton Analytics API (live)';
    console.log(`  ✅ Beta for ${t}: ${beta} [Newton live]`);
  } catch (err) {
    console.warn(`  ⚠️  Newton beta fetch failed for ${t}: ${err.message} — using fallback`);
    beta       = fallback.beta;
    betaSource = 'fallback (Newton API unavailable)';
  }

  try {
    expectedReturnRate = await fetchExpectedReturn(t);
    returnSource       = 'Yahoo Finance (live 1-year)';
    console.log(`  ✅ Expected return for ${t}: ${(expectedReturnRate * 100).toFixed(2)}% [Yahoo live]`);
  } catch (err) {
    console.warn(`  ⚠️  Yahoo return fetch failed for ${t}: ${err.message} — using fallback`);
    expectedReturnRate = fallback.expectedReturnRate;
    returnSource       = 'fallback (Yahoo Finance unavailable)';
  }

  const capmRate    = RISK_FREE_RATE + beta * (MARKET_EXPECTED_RETURN - RISK_FREE_RATE);
  const futureValue = p * Math.pow(1 + capmRate, y);

  return res.json({
    ticker,
    name:                     fund.name,
    category:                 fund.category,
    riskFreeRate:             RISK_FREE_RATE,
    beta,
    expectedReturnRate,
    marketExpectedReturnRate: MARKET_EXPECTED_RETURN,
    capmRate,
    principal:                p,
    years:                    y,
    futureValue,
    sources: {
      riskFreeRate:   'Hardcoded — US 10-yr Treasury (FRED DGS10)',
      beta:           betaSource,
      expectedReturn: returnSource,
      marketReturn:   'Hardcoded — S&P 500 5-year historical avg',
    },
  });
});

// ── System prompt helpers ──────────────────────────────────────────────────────

const BASE_SYSTEM_PROMPT = `You are an expert AI financial advisor specializing in mutual funds and personal finance. You have deep knowledge of:

• Mutual fund types: equity, debt, hybrid, index, sectoral, thematic, ELSS, liquid, overnight, and international funds
• Key concepts: NAV, AUM, expense ratio, exit load, SIP, SWP, STP, CAGR, alpha, beta, Sharpe ratio, standard deviation
• Fund selection criteria: risk-adjusted returns, fund manager track record, AMC reputation, benchmark comparison
• Investment strategies: SIP vs lump sum, goal-based investing, portfolio rebalancing, asset allocation
• Tax implications: STCG, LTCG, indexation benefit, ELSS tax deductions under Section 80C
• CAPM: Capital Asset Pricing Model — r = Rf + β(Rm − Rf) — and how it applies to mutual fund return estimation
• Market dynamics: interest rate impact on debt funds, equity market cycles, inflation hedging

Guidelines:
- Give clear, structured, and educational responses
- Use **bold** for key terms and numbers
- Use bullet lists for comparisons or multiple points
- Always recommend consulting a registered advisor for personalized investment decisions
- Be balanced: present pros and cons, risks alongside potential returns
- Acknowledge market uncertainty; past performance does not guarantee future results`;

/**
 * Builds a context-aware system prompt when the user has an active calculation.
 *
 * calculatorContext shape (sent from Angular after a successful calculation):
 * {
 *   ticker, name, category,
 *   principal, years,
 *   riskFreeRate, beta, expectedReturnRate,
 *   marketExpectedReturnRate, capmRate, futureValue
 * }
 *
 * When present, Gemini will reference the user's actual numbers instead of
 * giving generic examples.
 */
function buildSystemPrompt(calculatorContext) {
  if (!calculatorContext || !calculatorContext.ticker) {
    return BASE_SYSTEM_PROMPT;
  }

  const ctx = calculatorContext;
  const fmt = (n) => Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
  const pct = (n) => `${(Number(n) * 100).toFixed(2)}%`;
  const gain = ctx.futureValue - ctx.principal;
  const roi  = (gain / ctx.principal) * 100;

  const contextBlock = `

── ACTIVE CALCULATOR RESULT ──────────────────────────────────────────────────
The user has just run a CAPM projection in the calculator. Use these exact
numbers when answering questions — do not substitute generic examples.

  Fund:               ${ctx.name ?? ctx.ticker} (${ctx.ticker})
  Category:           ${ctx.category ?? 'N/A'}
  Initial Investment: ${fmt(ctx.principal)}
  Time Horizon:       ${ctx.years} year${ctx.years === 1 ? '' : 's'}

  CAPM Inputs:
    Risk-free Rate:   ${pct(ctx.riskFreeRate)}  (US 10-yr Treasury)
    Beta (β):         ${Number(ctx.beta).toFixed(3)}
    Fund Return (1Y): ${pct(ctx.expectedReturnRate)}
    Market Return:    ${pct(ctx.marketExpectedReturnRate)}  (S&P 500 5-yr avg)

  CAPM Rate (r):      ${pct(ctx.capmRate)}
  Projected Value:    ${fmt(ctx.futureValue)}
  Total Gain:         ${fmt(gain)}
  ROI:                ${roi.toFixed(2)}%

When the user asks things like "what does this mean?", "is this a good
return?", "how does beta affect my result?", "what if I invested more?",
or "should I switch funds?" — answer using the specific numbers above.
──────────────────────────────────────────────────────────────────────────────`;

  return BASE_SYSTEM_PROMPT + contextBlock;
}

// ── POST /api/chat ─────────────────────────────────────────────────────────────
// Body: {
//   messages: ChatMessage[],
//   calculatorContext?: {            ← optional, sent by Angular after calculation
//     ticker, name, category,
//     principal, years,
//     riskFreeRate, beta, expectedReturnRate,
//     marketExpectedReturnRate, capmRate, futureValue
//   }
// }
app.post('/api/chat', async (req, res) => {
  const { messages, calculatorContext } = req.body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array is required and must not be empty.' });
  }

  const safeMessages = messages
    .slice(-20)
    .filter(m => m && typeof m.role === 'string' && typeof m.content === 'string')
    .map(m => ({
      role:  m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content.slice(0, 4000) }],
    }));

  while (safeMessages.length > 0 && safeMessages[0].role === 'model') safeMessages.shift();

  const lastMessage = safeMessages.pop();
  if (!lastMessage) return res.status(400).json({ error: 'No valid user message found.' });

  // Build context-aware prompt
  const systemPrompt = buildSystemPrompt(calculatorContext);

  if (calculatorContext?.ticker) {
    console.log(`  💬 Chat with context: ${calculatorContext.ticker} | ${fmt(calculatorContext.principal)} | ${calculatorContext.years}yr`);
  }

  try {
    const model = genAI.getGenerativeModel({
      model: MODEL,
      systemInstruction: systemPrompt,
      generationConfig: { maxOutputTokens: MAX_TOKENS, temperature: 0.65 },
    });
    const chat   = model.startChat({ history: safeMessages });
    const result = await chat.sendMessage(lastMessage.parts[0].text);
    return res.json({ reply: result.response.text() });
  } catch (err) {
    console.error('Gemini error:', err.message);
    return res.status(err?.status ?? 500).json({ error: err?.message ?? 'Unexpected Gemini error.' });
  }
});

// ── GET /api/health ────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    model: MODEL,
    riskFreeRate: RISK_FREE_RATE,
    marketExpectedReturn: MARKET_EXPECTED_RETURN,
    timestamp: new Date().toISOString(),
  });
});

// helper used in console.log inside the chat route
function fmt(n) {
  return Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
}

// ── Start ──────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n✅  Server running at http://localhost:${PORT}`);
  console.log(`   Model        : ${MODEL}`);
  console.log(`   Risk-free    : ${(RISK_FREE_RATE * 100).toFixed(2)}%`);
  console.log(`   Market return: ${(MARKET_EXPECTED_RETURN * 100).toFixed(2)}%\n`);
});
