import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ApiService } from './api.service';

describe('ApiService', () => {
  let service: ApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [ApiService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(ApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('getFunds should GET .../api/funds', async () => {
    const p = service.getFunds();
    const req = httpMock.expectOne((r) => r.method === 'GET' && r.url.endsWith('/api/funds'));
    expect(req.request.method).toBe('GET');
    req.flush({ funds: [{ ticker: 'SPY', name: 'SPDR S&P 500 ETF Trust', category: 'ETF' }] });
    const data = await p;
    expect(data.funds.length).toBe(1);
    expect(data.funds[0].ticker).toBe('SPY');
  });

  it('getFutureValue should pass query params in URL', async () => {
    const p = service.getFutureValue('VOO', 10000, 5);
    const req = httpMock.expectOne((r) => {
      if (r.method !== 'GET' || !r.url.includes('/api/investment/future-value')) {
        return false;
      }
      expect(r.url).toContain('ticker=VOO');
      expect(r.url).toContain('principal=10000');
      expect(r.url).toContain('years=5');
      return true;
    });
    req.flush({
      ticker: 'VOO',
      principal: 10000,
      years: 5,
      riskFreeRate: 0.04,
      beta: 1,
      expectedReturnRate: 0.1,
      marketExpectedReturnRate: 0.1,
      capmRate: 0.1,
      futureValue: 16105.1,
    });
    const data = await p;
    expect(data.futureValue).toBe(16105.1);
    expect(data.ticker).toBe('VOO');
  });

  it('sendChat should POST /api/chat with messages body', async () => {
    const messages = [{ role: 'user' as const, content: 'hello' }];
    const p = service.sendChat(messages);
    const req = httpMock.expectOne((r) => r.method === 'POST' && r.url === '/api/chat');
    expect(req.request.body).toEqual({ messages });
    req.flush({ reply: 'hi' });
    const data = await p;
    expect(data.reply).toBe('hi');
  });
});
