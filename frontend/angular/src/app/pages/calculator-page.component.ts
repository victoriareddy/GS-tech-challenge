import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService, Fund, FutureValueResponse } from '../services/api.service';

type SourceKind = 'live' | 'cached';

interface SourceBadge {
  label: string;
  kind: SourceKind;
  title: string;
}

@Component({
  selector: 'app-calculator-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './calculator-page.component.html',
  styleUrl: './calculator-page.component.css'
})
export class CalculatorPageComponent implements OnInit {
  private readonly fundsCacheKey = 'mf_funds_cache_v1';
  private readonly requiredEtfs: Fund[] = [
    { ticker: 'VOO', name: 'Vanguard S&P 500 ETF', category: 'ETF' },
    { ticker: 'SPY', name: 'SPDR S&P 500 ETF Trust', category: 'ETF' },
    { ticker: 'QQQ', name: 'Invesco QQQ Trust', category: 'ETF' },
    { ticker: 'VTI', name: 'Vanguard Total Stock Market ETF', category: 'ETF' },
    { ticker: 'IVV', name: 'iShares Core S&P 500 ETF', category: 'ETF' }
  ];
  readonly minPrincipal = 1;
  readonly maxPrincipal = 1_000_000_000;
  readonly minYears = 0.1;
  readonly maxYears = 100;

  selectedTicker = '';
  principal?: number;
  years?: number;
  funds: Fund[] = [];
  groupedFunds: Array<{ category: string; funds: Fund[] }> = [];

  errorMessage = '';
  submitBusy = false;
  submitLabel = 'Calculate Future Value →';
  result: FutureValueResponse | null = null;

  betaBadge: SourceBadge | null = null;
  returnBadge: SourceBadge | null = null;
  riskFreeBadge: SourceBadge | null = null;

  @ViewChild('resultPanel') resultPanel?: ElementRef<HTMLElement>;

  constructor(
    private readonly apiService: ApiService,
    private readonly cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    void this.loadFunds();
  }

  async loadFunds(): Promise<void> {
    this.clearError();
    this.setSubmitState(true, 'Loading funds...');

    const cached = this.getCachedFunds();
    if (cached.length > 0 && this.funds.length === 0) {
      this.renderFunds(this.withRequiredEtfs(cached));
      this.setSubmitState(false, 'Calculate Future Value →');
    }

    try {
      const data = await this.apiService.getFunds();
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
      this.showError('Unable to load funds. Make sure the server is running on port 8080.');
      this.cdr.detectChanges();
    }
  }

  async submit(): Promise<void> {
    this.clearError();
    this.result = null;
    this.betaBadge = null;
    this.returnBadge = null;
    this.riskFreeBadge = null;

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

      this.result = await this.apiService.getFutureValue(this.selectedTicker, this.principal!, this.years!);
      if (!Number.isFinite(this.result.futureValue)) {
        throw new Error('Projected value exceeded supported range. Use a smaller amount or shorter horizon.');
      }
      this.betaBadge = this.toSourceBadge(this.result.sources?.beta);
      this.returnBadge = this.toSourceBadge(this.result.sources?.expectedReturn);
      this.riskFreeBadge = this.toSourceBadge(this.result.sources?.riskFreeRate);
      // Async/await can resume outside a tick that schedules CD; blur on <select> masked that.
      this.cdr.detectChanges();
      queueMicrotask(() => {
        const el = this.resultPanel?.nativeElement;
        if (el && typeof el.scrollIntoView === 'function') {
          el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Something went wrong while calculating.';
      this.showError(message);
      this.result = null;
      this.cdr.detectChanges();
    } finally {
      this.setSubmitState(false, 'Calculate Future Value →');
      this.cdr.detectChanges();
    }
  }

  toPercent(value: number): string {
    return `${(Number(value) * 100).toFixed(2)}%`;
  }

  toMoney(value: number): string {
    if (!Number.isFinite(value)) {
      return 'N/A';
    }
    return Number(value).toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 2
    });
  }

  formatFutureValue(value: number): string {
    if (!Number.isFinite(value) || value <= 0) {
      return 'Value out of range';
    }
    if (Math.abs(value) >= 1e15) {
      return `$${value.toExponential(2)}`;
    }
    return this.toMoney(value);
  }

  private renderFunds(funds: Fund[]): void {
    if (!Array.isArray(funds) || funds.length === 0) {
      throw new Error('No mutual funds available.');
    }
    const previous = this.selectedTicker;
    this.funds = [...funds];

    const byCategory = new Map<string, Fund[]>();
    for (const fund of this.funds) {
      const key = fund.category || '';
      const group = byCategory.get(key) ?? [];
      group.push(fund);
      byCategory.set(key, group);
    }
    this.groupedFunds = [...byCategory.entries()]
      .filter(([category]) => !!category)
      .map(([category, grouped]) => ({ category, funds: grouped }));

    if (previous && this.funds.some((fund) => fund.ticker === previous)) {
      this.selectedTicker = previous;
    } else if (!this.selectedTicker && this.funds.length > 0) {
      this.selectedTicker = this.funds[0].ticker;
    }
  }

  private withRequiredEtfs(funds: Fund[]): Fund[] {
    const byTicker = new Map<string, Fund>();
    for (const fund of funds) {
      byTicker.set(fund.ticker.toUpperCase(), fund);
    }
    for (const etf of this.requiredEtfs) {
      if (!byTicker.has(etf.ticker)) {
        byTicker.set(etf.ticker, etf);
      }
    }
    return [...byTicker.values()];
  }

  private getCachedFunds(): Fund[] {
    try {
      const raw = localStorage.getItem(this.fundsCacheKey);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private setCachedFunds(funds: Fund[]): void {
    try {
      localStorage.setItem(this.fundsCacheKey, JSON.stringify(funds));
    } catch {
      // Ignore localStorage write failures.
    }
  }

  private toSourceBadge(text?: string): SourceBadge | null {
    if (!text) return null;
    const lowered = text.toLowerCase();
    const isLive = lowered.includes('live') || lowered.includes('newton') || lowered.includes('yahoo');
    return {
      label: isLive ? '⚡ Live' : '📦 Cached',
      kind: isLive ? 'live' : 'cached',
      title: text
    };
  }

  private setSubmitState(busy: boolean, label: string): void {
    this.submitBusy = busy;
    this.submitLabel = label;
  }

  private showError(message: string): void {
    this.errorMessage = message;
  }

  private clearError(): void {
    this.errorMessage = '';
  }

  private validateInputs(): string | null {
    if (this.principal == null || this.years == null) {
      return 'Please enter principal and years.';
    }
    if (!Number.isFinite(this.principal) || !Number.isFinite(this.years)) {
      return 'Principal and years must be valid numbers.';
    }
    if (this.principal < this.minPrincipal || this.principal > this.maxPrincipal) {
      return `Initial investment must be between $${this.minPrincipal.toLocaleString('en-US')} and $${this.maxPrincipal.toLocaleString('en-US')}.`;
    }
    if (this.years < this.minYears || this.years > this.maxYears) {
      return `Time horizon must be between ${this.minYears} and ${this.maxYears} years.`;
    }
    return null;
  }
}
