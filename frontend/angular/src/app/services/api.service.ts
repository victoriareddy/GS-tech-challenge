import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

export interface Fund {
  ticker: string;
  name: string;
  category: string;
}

export interface FundsResponse {
  funds: Fund[];
}

export interface FutureValueResponse {
  ticker: string;
  name?: string;
  category?: string;
  principal: number;
  years: number;
  riskFreeRate: number;
  beta: number;
  expectedReturnRate: number;
  marketExpectedReturnRate: number;
  capmRate: number;
  futureValue: number;
  sources?: {
    beta?: string;
    expectedReturn?: string;
    riskFreeRate?: string;
  };
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatResponse {
  reply: string;
}

// Mirrors FutureValueResponse — sent to /api/chat so Gemini can reference
// the user's actual calculation when answering questions.
export interface CalculatorContext {
  ticker: string;
  name?: string;
  category?: string;
  principal: number;
  years: number;
  riskFreeRate: number;
  beta: number;
  expectedReturnRate: number;
  marketExpectedReturnRate: number;
  capmRate: number;
  futureValue: number;
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  // Calculator + chat endpoints all live on the Node/Express server (port 3000).
  // Change this one line if you move the backend to a different port.
  private readonly calculatorApiBase = `${window.location.protocol}//${window.location.hostname}:3000/api`;

  // Stores the last CAPM result so chat-page can send it as context to Gemini.
  // Set by calculator-page after a successful calculation.
  lastCalculatorResult: CalculatorContext | null = null;

  constructor(private readonly http: HttpClient) {}

  /** GET /api/funds */
  async getFunds(): Promise<FundsResponse> {
    try {
      return await firstValueFrom(
        this.http.get<FundsResponse>(`${this.calculatorApiBase}/funds`)
      );
    } catch (error: unknown) {
      throw this.toApiError(error, 'Unable to load funds.');
    }
  }

  /** GET /api/investment/future-value?ticker=VOO&principal=10000&years=5 */
  async getFutureValue(
    ticker: string,
    principal: number,
    years: number
  ): Promise<FutureValueResponse> {
    const params = new HttpParams()
      .set('ticker', ticker)
      .set('principal', String(principal))
      .set('years', String(years));

    try {
      return await firstValueFrom(
        this.http.get<FutureValueResponse>(
          `${this.calculatorApiBase}/investment/future-value`,
          { params }
        )
      );
    } catch (error: unknown) {
      throw this.toApiError(error, 'Unable to calculate future value.');
    }
  }

  /** POST /api/chat — goes through Angular proxy to avoid CORS */
  sendChat(messages: ChatMessage[], calculatorContext?: CalculatorContext): Promise<ChatResponse> {
    return firstValueFrom(
      this.http.post<ChatResponse>(`${this.calculatorApiBase}/chat`, {
        messages,
        ...(calculatorContext ? { calculatorContext } : {}),
      })
    );
  }

  // ── Error helpers ───────────────────────────────────────────────────────────

  private toApiError(error: unknown, fallback: string): Error {
    if (error instanceof HttpErrorResponse) {
      const serverMessage = this.extractServerMessage(error);
      if (serverMessage) return new Error(serverMessage);
      if (error.status > 0) return new Error(`${fallback} (HTTP ${error.status})`);
    }
    if (error instanceof Error && error.message) return new Error(error.message);
    return new Error(fallback);
  }

  private extractServerMessage(error: HttpErrorResponse): string | null {
    const payload = error.error;
    if (!payload) return null;
    if (
      typeof payload === 'object' &&
      'error' in payload &&
      typeof payload['error'] === 'string'
    ) {
      return payload['error'];
    }
    if (typeof payload === 'string') {
      try {
        const parsed = JSON.parse(payload);
        if (parsed && typeof parsed.error === 'string') return parsed.error;
      } catch {
        return null;
      }
    }
    return null;
  }
}