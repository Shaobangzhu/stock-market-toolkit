import { setTimeout as sleep } from 'node:timers/promises';
import type { AppConfig } from '../config/env.js';
import { canonicalSymbol, dateSchema, ProviderError, invalidPayload, type MarketDataProvider } from './market-data.js';
import { normalizeInstrument, normalizePrices, parseProviderJson } from './tiingo-normalization.js';

export const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
export interface RequestBudget {
  reserve(symbol: string, bytes: number): Promise<string>;
  complete(id: string, bytes: number, errorCode?: string, retryAfter?: Date): Promise<void>;
}
export interface TiingoTransportOptions {
  fetch?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<unknown>;
  now?: () => Date;
  timeoutMs?: number;
}

export class TiingoMarketDataProvider implements MarketDataProvider {
  readonly name = 'TIINGO' as const;
  readonly configured: boolean;
  private readonly token: string | undefined;
  private readonly transport: typeof fetch;
  private readonly sleep: (milliseconds: number) => Promise<unknown>;
  private readonly now: () => Date;
  private readonly timeoutMs: number;
  private authBlocked = false;
  private cooldown?: Date;
  private tail: Promise<unknown> = Promise.resolve();
  private stopped = false;
  private readonly controllers = new Set<AbortController>();

  constructor(config: Pick<AppConfig, 'TIINGO_API_KEY'>, private readonly budget: RequestBudget, options: TiingoTransportOptions = {}) {
    this.token = config.TIINGO_API_KEY;
    this.configured = !!this.token;
    this.transport = options.fetch ?? fetch;
    this.sleep = options.sleep ?? sleep;
    this.now = options.now ?? (() => new Date());
    this.timeoutMs = options.timeoutMs ?? 10000;
  }

  async resolveInstrument(symbol: string) {
    const canonical = canonicalSymbol(symbol);
    return normalizeInstrument(await this.request(canonical, false), canonical);
  }
  async getDailyHistory(symbol: string, from: string, to: string) {
    if (!dateSchema.safeParse(from).success || !dateSchema.safeParse(to).success || from > to) {
      throw new ProviderError(400, 'VALIDATION_ERROR', 'Invalid daily history date range.');
    }
    const payload = await this.request(canonicalSymbol(symbol), true, { startDate: from, endDate: to, resampleFreq: 'daily' });
    return normalizePrices(payload, this.now(), { from, to });
  }
  async getLatestEod(symbol: string) {
    const bars = normalizePrices(await this.request(canonicalSymbol(symbol), true), this.now());
    if (bars.filter((bar) => bar.adjustmentMode === 'RAW').length !== 1) throw invalidPayload();
    return bars;
  }
  shutdown(): void {
    this.stopped = true;
    for (const controller of this.controllers) controller.abort();
  }

  private request(symbol: string, prices: boolean, query: Record<string, string> = {}): Promise<unknown> {
    // One outbound request at a time, shared by every job and metadata lookup.
    const result = this.tail.then(() => this.send(symbol, prices, query));
    this.tail = result.catch(() => undefined);
    return result;
  }

  private async send(symbol: string, prices: boolean, query: Record<string, string>): Promise<unknown> {
    if (this.stopped) throw new ProviderError(503, 'PROVIDER_UNAVAILABLE', 'The market-data worker is stopping.');
    if (!this.token) throw new ProviderError(503, 'PROVIDER_NOT_CONFIGURED', 'Configure TIINGO_API_KEY in the backend environment file.');
    if (this.authBlocked) throw new ProviderError(503, 'PROVIDER_AUTH_FAILED', 'Tiingo credentials were rejected. Correct the backend key and restart the backend.');
    if (this.cooldown && this.cooldown > this.now()) throw new ProviderError(429, 'PROVIDER_RATE_LIMITED', 'Tiingo requests are temporarily paused.', this.cooldown);
    const url = new URL(`https://api.tiingo.com/tiingo/daily/${encodeURIComponent(symbol)}${prices ? '/prices' : ''}`);
    url.search = new URLSearchParams({ format: 'json', ...query }).toString();
    for (let attempt = 0; attempt < 3; attempt++) {
      if (this.stopped) throw new ProviderError(503, 'PROVIDER_UNAVAILABLE', 'The market-data worker is stopping.');
      const usageId = await this.budget.reserve(symbol, MAX_RESPONSE_BYTES);
      let bytes = 0;
      let bodyCompleted = false;
      let failure: ProviderError | undefined;
      let received: unknown;
      const controller = new AbortController();
      this.controllers.add(controller);
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.transport(url, { method: 'GET', headers: { Authorization: `Token ${this.token}`, Accept: 'application/json' }, redirect: 'error', signal: controller.signal });
        const status = response.status;
        if (status === 401 || status === 403) {
          this.authBlocked = true;
          failure = new ProviderError(503, 'PROVIDER_AUTH_FAILED', 'Tiingo credentials or EOD permissions were rejected. Check backend configuration.');
        } else if (status === 404 || status === 400) {
          failure = new ProviderError(404, 'INVALID_SYMBOL', 'Tiingo does not support this stock symbol.');
        } else if (status === 429) {
          const header = response.headers.get('retry-after');
          const seconds = header && /^\d+$/.test(header) ? Number(header) : undefined;
          const parsed = seconds !== undefined ? this.now().getTime() + seconds * 1000 : Date.parse(header ?? '');
          this.cooldown = new Date(Math.max(this.now().getTime() + 1000, Number.isFinite(new Date(parsed).getTime()) ? parsed : this.now().getTime() + 60000));
          failure = new ProviderError(429, 'PROVIDER_RATE_LIMITED', 'Tiingo rate limit reached. Retry after the reported cooldown.', this.cooldown);
        } else if (!response.ok) {
          failure = new ProviderError(502, 'PROVIDER_UNAVAILABLE', 'Tiingo is temporarily unavailable.');
        }
        if (!response.body) throw invalidPayload();
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        try {
          while (true) {
            const part = await reader.read();
            if (part.done) { bodyCompleted = true; break; }
            bytes += part.value.byteLength;
            if (bytes > MAX_RESPONSE_BYTES) { await reader.cancel(); throw invalidPayload(); }
            if (!failure) chunks.push(part.value);
          }
        } finally { reader.releaseLock(); }
        if (!failure) {
          if (!response.headers.get('content-type')?.includes('application/json')) throw invalidPayload();
          received = parseProviderJson(Buffer.concat(chunks).toString('utf8'));
        }
      } catch (error) {
        failure ??= error instanceof ProviderError ? error : new ProviderError(502, 'PROVIDER_UNAVAILABLE', 'Tiingo request failed or timed out.');
      } finally {
        clearTimeout(timer);
        this.controllers.delete(controller);
        // If interrupted before a complete read, keep the full reservation.
        await this.budget.complete(usageId, bodyCompleted ? Math.min(bytes, MAX_RESPONSE_BYTES) : MAX_RESPONSE_BYTES, failure?.code, failure?.retryAfter);
      }
      if (!failure) return received;
      const retryWait = failure.retryAfter ? failure.retryAfter.getTime() - this.now().getTime() : 250 * 2 ** attempt;
      if (this.stopped || attempt === 2 || !['PROVIDER_UNAVAILABLE', 'PROVIDER_RATE_LIMITED'].includes(failure.code) || retryWait > 2000) throw failure;
      await this.sleep(Math.max(0, retryWait));
    }
    throw new ProviderError(502, 'PROVIDER_UNAVAILABLE', 'Tiingo request failed.');
  }
}
