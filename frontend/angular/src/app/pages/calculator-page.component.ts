import { CommonModule } from '@angular/common';
import {
  AfterViewChecked,
  ChangeDetectorRef,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  Chart,
  ChartConfiguration,
  TooltipItem,
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Filler,
  Tooltip,
  Legend,
} from 'chart.js';
import { ApiService, CalculatorContext, Fund, FutureValueResponse } from '../services/api.service';

// Register only the modules we use (keeps bundle lean)
Chart.register(
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Filler,
  Tooltip,
  Legend
);

type SourceKind = 'live' | 'cached';
type ChartMode  = 'capm' | 'compare' | 'inflation';

interface SourceBadge {
  label: string;
  kind:  SourceKind;
  title: string;
}

interface Milestone {
  label:    string;
  years:    number;
  achieved: boolean;
  extra:    number;
}

const INFLATION_RATE = 0.030;  // ~3 % avg US inflation
const SP500_RATE     = 0.1050; // S&P 500 5-year historical avg

@Component({
  selector: 'app-calculator-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './calculator-page.component.html',
  styleUrl: './calculator-page.component.css',
})
export class CalculatorPageComponent
  implements OnInit, AfterViewChecked, OnDestroy
{
  // ── Validation constants ────────────────────────────────────────────────────
  private readonly fundsCacheKey = 'mf_funds_cache_v1';
  private readonly requiredEtfs: Fund[] = [
    { ticker: 'VOO',  name: 'Vanguard S&P 500 ETF',            category: 'ETF' },
    { ticker: 'SPY',  name: 'SPDR S&P 500 ETF Trust',          category: 'ETF' },
    { ticker: 'QQQ',  name: 'Invesco QQQ Trust',               category: 'ETF' },
    { ticker: 'VTI',  name: 'Vanguard Total Stock Market ETF',  category: 'ETF' },
    { ticker: 'IVV',  name: 'iShares Core S&P 500 ETF',        category: 'ETF' },
  ];

  readonly minPrincipal = 1;
  readonly maxPrincipal = 1_000_000_000;
  readonly minYears     = 0.1;
  readonly maxYears     = 100;

  // ── Form state ──────────────────────────────────────────────────────────────
  selectedTicker = '';
  principal?: number;
  years?: number;

  // ── Fund data ───────────────────────────────────────────────────────────────
  funds: Fund[] = [];
  groupedFunds: Array<{ category: string; funds: Fund[] }> = [];

  // ── UI state ────────────────────────────────────────────────────────────────
  errorMessage = '';
  submitBusy   = false;
  submitLabel  = 'Calculate Future Value →';

  // ── Result ──────────────────────────────────────────────────────────────────
  result: FutureValueResponse | null = null;
  betaBadge:     SourceBadge | null  = null;
  returnBadge:   SourceBadge | null  = null;
  riskFreeBadge: SourceBadge | null  = null;

  // ── Chart state ─────────────────────────────────────────────────────────────
  showChart   = false;
  chartMode: ChartMode = 'capm';
  readonly chartModes: { key: ChartMode; label: string }[] = [
    { key: 'capm',      label: 'CAPM'        },
    { key: 'compare',   label: 'vs S&P 500'  },
    { key: 'inflation', label: 'Real (Adj.)' },
  ];

  chartTotalGain = '';
  chartRoi       = '';
  chartDoubleYrs = '';
  milestones: Milestone[] = [];

  private chartInstance: Chart | null = null;
  private pendingChartRender = false;

  // ── ViewChild refs ──────────────────────────────────────────────────────────
  @ViewChild('resultPanel') resultPanel?: ElementRef<HTMLElement>;
  @ViewChild('chartCanvas') chartCanvas?: ElementRef<HTMLCanvasElement>;

  constructor(
    private readonly apiService: ApiService,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  ngOnInit(): void {
    void this.loadFunds();
  }

  /** Render chart after Angular has written the canvas to the DOM. */
  ngAfterViewChecked(): void {
    if (this.pendingChartRender && this.chartCanvas?.nativeElement) {
      this.pendingChartRender = false;
      this.buildChart();
    }
  }

  ngOnDestroy(): void {
    this.chartInstance?.destroy();
  }

  // ── Fund loading ────────────────────────────────────────────────────────────

  async loadFunds(): Promise<void> {
    this.clearError();
    this.setSubmitState(true, 'Loading funds...');

    const cached = this.getCachedFunds();
    if (cached.length > 0 && this.funds.length === 0) {
      this.renderFunds(this.withRequiredEtfs(cached));
      this.setSubmitState(false, 'Calculate Future Value →');
    }

    try {
      const data        = await this.apiService.getFunds();
      const mergedFunds = this.withRequiredEtfs(data.funds);
      this.renderFunds(mergedFunds);
      this.setCachedFunds(mergedFunds);
      this.setSubmitState(false, 'Calculate Future Value →');
      this.cdr.detectChanges();
    } catch {
      if (this.funds.length === 0) {
        this.setSubmitState(true, 'Calculate Future Value →');
      } else {
        this.setSubmitState(false, 'Calculate Future Value →');
      }
      this.showError('Unable to load funds. Make sure the server is running on port 3000.');
      this.cdr.detectChanges();
    }
  }

  // ── Form submit ─────────────────────────────────────────────────────────────

  async submit(): Promise<void> {
    this.clearError();
    this.result        = null;
    this.betaBadge     = null;
    this.returnBadge   = null;
    this.riskFreeBadge = null;
    this.showChart     = false;

    if (!this.selectedTicker) {
      this.showError('Please select a fund or ETF.');
      return;
    }

    const validationError = this.validateInputs();
    if (validationError) {
      this.showError(validationError);
      return;
    }

    try {
      this.setSubmitState(true, 'Fetching live data & calculating...');
      this.cdr.detectChanges();

      this.result = await this.apiService.getFutureValue(
        this.selectedTicker,
        this.principal!,
        this.years!,
      );

      if (!Number.isFinite(this.result.futureValue)) {
        throw new Error(
          'Projected value exceeded supported range. Use a smaller amount or shorter horizon.',
        );
      }

      this.betaBadge     = this.toSourceBadge(this.result.sources?.beta);
      this.returnBadge   = this.toSourceBadge(this.result.sources?.expectedReturn);
      this.riskFreeBadge = this.toSourceBadge(this.result.sources?.riskFreeRate);

      // Store result in the shared service so chat-page can pass it to Gemini
      this.apiService.lastCalculatorResult = {
        ticker:                   this.result.ticker,
        name:                     this.result.name,
        category:                 this.result.category,
        principal:                this.result.principal,
        years:                    this.result.years,
        riskFreeRate:             this.result.riskFreeRate,
        beta:                     this.result.beta,
        expectedReturnRate:       this.result.expectedReturnRate,
        marketExpectedReturnRate: this.result.marketExpectedReturnRate,
        capmRate:                 this.result.capmRate,
        futureValue:              this.result.futureValue,
      };

      // Schedule chart render — canvas appears after next CD cycle
      this.showChart          = true;
      this.pendingChartRender = true;
      this.updateChartStats();
      this.updateMilestones();

      this.cdr.detectChanges();

      queueMicrotask(() => {
        this.resultPanel?.nativeElement?.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
        });
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : 'Something went wrong while calculating.';
      this.showError(message);
      this.result    = null;
      this.showChart = false;
      this.cdr.detectChanges();
    } finally {
      this.setSubmitState(false, 'Calculate Future Value →');
      this.cdr.detectChanges();
    }
  }

  // ── Chart mode toggle ───────────────────────────────────────────────────────

  setChartMode(mode: ChartMode): void {
    this.chartMode = mode;
    if (this.result && this.chartCanvas?.nativeElement) {
      this.buildChart();
    }
  }

  // ── Public formatters (used in template + spec) ─────────────────────────────

  toPercent(value: number): string {
    return `${(Number(value) * 100).toFixed(2)}%`;
  }

  toMoney(value: number): string {
    if (!Number.isFinite(value)) return 'N/A';
    return Number(value).toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 2,
    });
  }

  formatFutureValue(value: number): string {
    if (!Number.isFinite(value) || value <= 0) return 'Value out of range';
    if (Math.abs(value) >= 1e15) return `$${value.toExponential(2)}`;
    return this.toMoney(value);
  }

  // ── Chart helpers ───────────────────────────────────────────────────────────

  private buildChart(): void {
    if (!this.result || !this.chartCanvas?.nativeElement) return;

    const { principal, years, capmRate } = this.result;
    const labels: string[]  = [];
    const capmData: number[] = [];
    const sp500Data: number[] = [];
    const realData: number[] = [];

    for (let y = 0; y <= years; y++) {
      labels.push(y === 0 ? 'Now' : `Yr ${y}`);
      capmData.push(parseFloat((principal * Math.pow(1 + capmRate,    y)).toFixed(2)));
      sp500Data.push(parseFloat((principal * Math.pow(1 + SP500_RATE, y)).toFixed(2)));
      realData.push(parseFloat(
        (principal * Math.pow(1 + capmRate, y) / Math.pow(1 + INFLATION_RATE, y)).toFixed(2)
      ));
    }

    const baseDataset = {
      label: `${this.result.ticker} (CAPM)`,
      data: capmData,
      borderColor: '#3b82f6',
      backgroundColor: 'rgba(59,130,246,0.08)',
      borderWidth: 2.5,
      pointRadius: years <= 15 ? 4 : 2,
      pointHoverRadius: 7,
      pointBackgroundColor: '#3b82f6',
      fill: true,
      tension: 0.4,
    };

    const sp500Dataset = {
      label: 'S&P 500 avg',
      data: sp500Data,
      borderColor: '#f5c842',
      backgroundColor: 'rgba(245,200,66,0.05)',
      borderWidth: 2,
      borderDash: [6, 3],
      pointRadius: 0,
      pointHoverRadius: 6,
      pointBackgroundColor: '#f5c842',
      fill: false,
      tension: 0.4,
    };

    const realDataset = {
      label: `${this.result.ticker} (inflation-adj.)`,
      data: realData,
      borderColor: '#34d399',
      backgroundColor: 'rgba(52,211,153,0.07)',
      borderWidth: 2,
      borderDash: [4, 4],
      pointRadius: 0,
      pointHoverRadius: 6,
      pointBackgroundColor: '#34d399',
      fill: true,
      tension: 0.4,
    };

    const datasets =
      this.chartMode === 'capm'      ? [baseDataset] :
      this.chartMode === 'compare'   ? [baseDataset, sp500Dataset] :
                                       [baseDataset, realDataset];

    this.chartInstance?.destroy();

    const config: ChartConfiguration<'line'> = {
      type: 'line',
      data: { labels, datasets: datasets as ChartConfiguration<'line'>['data']['datasets'] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        animation: { duration: 900, easing: 'easeInOutQuart' },
        plugins: {
          legend: {
            position: 'top',
            align: 'end',
            labels: {
              color: '#6b7fa3',
              font: { family: 'DM Sans', size: 11 },
              boxWidth: 12,
              boxHeight: 2,
              usePointStyle: true,
              pointStyle: 'line',
            },
          },
          tooltip: {
            backgroundColor: '#1a2235',
            borderColor: '#243049',
            borderWidth: 1,
            titleColor: '#e8edf5',
            bodyColor: '#6b7fa3',
            padding: 12,
            callbacks: {
              label: (ctx: TooltipItem<'line'>) => {
                const val  = ctx.parsed.y ?? 0;
                const gain = val - principal;
                const pct  = ((gain / principal) * 100).toFixed(1);
                const fmt  = val.toLocaleString('en-US', {
                  style: 'currency', currency: 'USD', maximumFractionDigits: 0,
                });
                return ` ${ctx.dataset.label}: ${fmt} (${gain >= 0 ? '+' : ''}${pct}%)`;
              },
            },
          },
        },
        scales: {
          x: {
            grid: { color: 'rgba(36,48,73,0.6)' },
            ticks: { color: '#6b7fa3', font: { family: 'DM Sans', size: 11 }, maxTicksLimit: 10 },
          },
          y: {
            grid: { color: 'rgba(36,48,73,0.6)' },
            ticks: {
              color: '#6b7fa3',
              font: { family: 'DM Sans', size: 11 },
              callback: (v: number | string) => {
                const n = Number(v);
                if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
                if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}k`;
                return `$${n}`;
              },
            },
          },
        },
      },
    };

    this.chartInstance = new Chart(
      this.chartCanvas.nativeElement,
      config,
    );
  }

  private updateChartStats(): void {
    if (!this.result) return;
    const { principal, years, capmRate } = this.result;
    const finalVal  = principal * Math.pow(1 + capmRate, years);
    const gain      = finalVal - principal;
    const roi       = (gain / principal) * 100;
    const doubleYrs = Math.log(2) / Math.log(1 + capmRate);

    this.chartTotalGain = gain.toLocaleString('en-US', {
      style: 'currency', currency: 'USD', maximumFractionDigits: 0,
    });
    this.chartRoi       = `+${roi.toFixed(1)}%`;
    this.chartDoubleYrs = Number.isFinite(doubleYrs) && doubleYrs < 1000
      ? `${doubleYrs.toFixed(1)} yrs`
      : '—';
  }

  private updateMilestones(): void {
    if (!this.result) return;
    const { years, capmRate } = this.result;

    this.milestones = [2, 5, 10]
      .map((mult) => {
        const yrs = Math.log(mult) / Math.log(1 + capmRate);
        return {
          label:    `${mult}× your money`,
          years:    yrs,
          achieved: yrs <= years,
          extra:    yrs - years,
        };
      })
      .filter((m) => m.years > 0 && Number.isFinite(m.years) && m.years <= years * 3);
  }

  // ── Fund rendering helpers ──────────────────────────────────────────────────

  private renderFunds(funds: Fund[]): void {
    if (!Array.isArray(funds) || funds.length === 0) {
      throw new Error('No mutual funds available.');
    }
    const previous  = this.selectedTicker;
    this.funds      = [...funds];

    const byCategory = new Map<string, Fund[]>();
    for (const fund of this.funds) {
      const key   = fund.category || '';
      const group = byCategory.get(key) ?? [];
      group.push(fund);
      byCategory.set(key, group);
    }
    this.groupedFunds = [...byCategory.entries()]
      .filter(([category]) => !!category)
      .map(([category, grouped]) => ({ category, funds: grouped }));

    if (previous && this.funds.some((f) => f.ticker === previous)) {
      this.selectedTicker = previous;
    } else if (!this.selectedTicker && this.funds.length > 0) {
      this.selectedTicker = this.funds[0].ticker;
    }
  }

  private withRequiredEtfs(funds: Fund[]): Fund[] {
    const byTicker = new Map<string, Fund>();
    for (const fund of funds) byTicker.set(fund.ticker.toUpperCase(), fund);
    for (const etf of this.requiredEtfs) {
      if (!byTicker.has(etf.ticker)) byTicker.set(etf.ticker, etf);
    }
    return [...byTicker.values()];
  }

  private getCachedFunds(): Fund[] {
    try {
      const raw = localStorage.getItem(this.fundsCacheKey);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  }

  private setCachedFunds(funds: Fund[]): void {
    try { localStorage.setItem(this.fundsCacheKey, JSON.stringify(funds)); } catch { /* ignore */ }
  }

  private toSourceBadge(text?: string): SourceBadge | null {
    if (!text) return null;
    const isLive = /live|newton|yahoo/i.test(text);
    return { label: isLive ? '⚡ Live' : '📦 Cached', kind: isLive ? 'live' : 'cached', title: text };
  }

  private setSubmitState(busy: boolean, label: string): void {
    this.submitBusy  = busy;
    this.submitLabel = label;
  }

  private showError(message: string): void  { this.errorMessage = message; }
  private clearError(): void                { this.errorMessage = '';      }

  private validateInputs(): string | null {
    if (this.principal == null || this.years == null)
      return 'Please enter principal and years.';
    if (!Number.isFinite(this.principal) || !Number.isFinite(this.years))
      return 'Principal and years must be valid numbers.';
    if (this.principal < this.minPrincipal || this.principal > this.maxPrincipal)
      return `Initial investment must be between $${this.minPrincipal.toLocaleString('en-US')} and $${this.maxPrincipal.toLocaleString('en-US')}.`;
    if (this.years < this.minYears || this.years > this.maxYears)
      return `Time horizon must be between ${this.minYears} and ${this.maxYears} years.`;
    return null;
  }
}