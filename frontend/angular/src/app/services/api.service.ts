import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
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

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly calculatorApiBase = `${window.location.protocol}//${window.location.hostname}:8080/api`;

  constructor(private readonly http: HttpClient) {}

  async getFunds(): Promise<FundsResponse> {
    try {
      return await firstValueFrom(this.http.get<FundsResponse>(`${this.calculatorApiBase}/funds`));
    } catch (error: unknown) {
      throw this.toApiError(error, 'Unable to load funds.');
    }
  }

  async getFutureValue(ticker: string, principal: number, years: number): Promise<FutureValueResponse> {
    const params = new URLSearchParams({
      ticker,
      principal: String(principal),
      years: String(years)
    });
    try {
      return await firstValueFrom(
        this.http.get<FutureValueResponse>(`${this.calculatorApiBase}/investment/future-value?${params}`)
      );
    } catch (error: unknown) {
      throw this.toApiError(error, 'Unable to calculate future value.');
    }
  }

  sendChat(messages: ChatMessage[]): Promise<ChatResponse> {
    return firstValueFrom(this.http.post<ChatResponse>('/api/chat', { messages }));
  }

  private toApiError(error: unknown, fallback: string): Error {
    if (error instanceof HttpErrorResponse) {
      const serverMessage = this.extractServerMessage(error);
      if (serverMessage) {
        return new Error(serverMessage);
      }
      if (error.status > 0) {
        return new Error(`${fallback} (HTTP ${error.status})`);
      }
    }
    if (error instanceof Error && error.message) {
      return new Error(error.message);
    }
    return new Error(fallback);
  }

  private extractServerMessage(error: HttpErrorResponse): string | null {
    const payload = error.error;
    if (!payload) {
      return null;
    }
    if (typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string') {
      return payload.error;
    }
    if (typeof payload === 'string') {
      try {
        const parsed = JSON.parse(payload);
        if (parsed && typeof parsed.error === 'string') {
          return parsed.error;
        }
      } catch {
        return null;
      }
    }
    return null;
  }
}
