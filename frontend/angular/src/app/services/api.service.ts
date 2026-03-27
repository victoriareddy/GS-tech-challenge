import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
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

  getFunds(): Promise<FundsResponse> {
    return firstValueFrom(this.http.get<FundsResponse>(`${this.calculatorApiBase}/funds`));
  }

  getFutureValue(ticker: string, principal: number, years: number): Promise<FutureValueResponse> {
    const params = new URLSearchParams({
      ticker,
      principal: String(principal),
      years: String(years)
    });
    return firstValueFrom(
      this.http.get<FutureValueResponse>(`${this.calculatorApiBase}/investment/future-value?${params}`)
    );
  }

  sendChat(messages: ChatMessage[]): Promise<ChatResponse> {
    return firstValueFrom(this.http.post<ChatResponse>('/api/chat', { messages }));
  }
}
