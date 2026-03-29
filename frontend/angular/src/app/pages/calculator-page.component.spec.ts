import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { CalculatorPageComponent } from './calculator-page.component';
import { ApiService, FutureValueResponse } from '../services/api.service';
import { vi } from 'vitest';

describe('CalculatorPageComponent', () => {
  let fixture: ComponentFixture<CalculatorPageComponent>;
  let component: CalculatorPageComponent;

  const mockFutureValue: FutureValueResponse = {
    ticker: 'SPY',
    riskFreeRate: 0.04,
    beta: 1,
    expectedReturnRate: 0.1,
    marketExpectedReturnRate: 0.105,
    capmRate: 0.1,
    futureValue: 16105.1,
    sources: {
      beta: 'Newton Analytics (live)',
      expectedReturn: 'Yahoo Finance (live)',
      riskFreeRate: 'FRED (live)',
    },
  };

  const getFunds = vi.fn().mockResolvedValue({
    funds: [{ ticker: 'SPY', name: 'SPDR S&P 500 ETF Trust', category: 'ETF' }],
  });
  const getFutureValue = vi.fn().mockResolvedValue(mockFutureValue);
  const sendChat = vi.fn();

  beforeEach(async () => {
    getFunds.mockClear();
    getFutureValue.mockClear();
    sendChat.mockClear();

    await TestBed.configureTestingModule({
      imports: [CalculatorPageComponent, RouterTestingModule],
    })
      .overrideProvider(ApiService, {
        useValue: {
          getFunds,
          getFutureValue,
          sendChat,
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(CalculatorPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should show error when ticker is missing', async () => {
    component.selectedTicker = '';
    component.principal = 10000;
    component.years = 5;
    await component.submit();
    expect(component.errorMessage).toContain('select');
    expect(getFutureValue).not.toHaveBeenCalled();
  });

  it('should show error when principal or years missing', async () => {
    component.selectedTicker = 'SPY';
    component.principal = undefined;
    component.years = 5;
    await component.submit();
    expect(component.errorMessage).toContain('principal');
    expect(getFutureValue).not.toHaveBeenCalled();
  });

  it('should call getFutureValue and set result on success', async () => {
    component.selectedTicker = 'SPY';
    component.principal = 10000;
    component.years = 5;
    await component.submit();
    expect(getFutureValue).toHaveBeenCalledWith('SPY', 10000, 5);
    expect(component.result).toEqual(mockFutureValue);
    expect(component.errorMessage).toBe('');
    expect(component.submitBusy).toBe(false);
  });

  it('toPercent should format decimals', () => {
    expect(component.toPercent(0.0425)).toBe('4.25%');
  });

  it('toMoney should format USD', () => {
    const s = component.toMoney(16105.1);
    expect(s).toContain('16');
    expect(s).toContain('105');
  });
});
