import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import type { AppConfig } from '../config/env.js';
import { canonicalSymbol, ProviderError } from './market-data.js';
import { parseProviderJson } from './tiingo-normalization.js';
import { normalizeTickerIndex, normalizeFilings, normalizeCompanyFacts, secInvalid, type SecIdentity, type NormalizedFiling, type NormalizedFact } from './sec-normalization.js';

export interface SecBundle { identity: SecIdentity; filings: NormalizedFiling[]; facts: NormalizedFact[]; historyComplete: boolean; issuerTickerCount: number; retrievedAt: Date }
export interface SecAdmission {
  reserve(): Promise<{ id: string; waitMs: number }>;
  complete(id: string, bytes: number, errorCode?: string, retryAfter?: Date): Promise<void>;
}
interface Options { fetch?: typeof fetch; now?: () => Date; sleep?: (ms: number) => Promise<unknown>; admission?: SecAdmission; requestTimeoutMs?: number }
export class SecEdgarProvider {
  readonly name = 'SEC_EDGAR';
  readonly configured: boolean;
  private fetcher: typeof fetch;
  private now: () => Date;
  private sleep: (ms: number) => Promise<unknown>;
  private queue: Promise<unknown> = Promise.resolve();
  private cache = new Map<string, { until: number; payload: unknown }>();
  private nextRequest = 0;
  private blockedUntil = 0;
  private stopped = false;
  private controllers = new Set<AbortController>();
  private admission: SecAdmission | undefined;
  private requestTimeoutMs: number;
  constructor(private config: Pick<AppConfig, 'SEC_EDGAR_USER_AGENT' | 'SEC_EDGAR_MAX_RPS'>, options: Options = {}) {
    // A syntax-valid example contact is not a valid operational contact.
    const contact = config.SEC_EDGAR_USER_AGENT?.match(/[^\s<>]+@([^\s<>]+)/)?.[1]?.toLowerCase();
    this.configured = !!contact && !/^(?:example\.(?:com|org|net)|localhost)$/.test(contact) && !/\.(?:invalid|test|example)$/.test(contact)
      && !/(?:your-real-contact|your-email|changeme|placeholder)/i.test(config.SEC_EDGAR_USER_AGENT!);
    this.fetcher = options.fetch ?? fetch; this.now = options.now ?? (() => new Date()); this.sleep = options.sleep ?? delay;
    this.admission = options.admission;
    this.requestTimeoutMs = Math.min(15_000, Math.max(1, options.requestTimeoutMs ?? 15_000));
  }
  shutdown() { this.stopped = true; for (const controller of this.controllers) controller.abort(); }
  private async json(url: string, ttl = 15 * 60_000): Promise<unknown> {
    const action = async () => {
      if (!this.configured) throw new ProviderError(503, 'PROVIDER_NOT_CONFIGURED', 'Configure SEC_EDGAR_USER_AGENT with your real contact before SEC synchronization.');
      if (this.stopped) throw new ProviderError(503, 'PROVIDER_UNAVAILABLE', 'SEC synchronization has stopped.');
      const cached = this.cache.get(url);
      if (cached && cached.until > this.now().getTime()) return cached.payload;
      if (this.blockedUntil > this.now().getTime()) throw new ProviderError(429, 'PROVIDER_RATE_LIMITED', 'SEC access is cooling down. Retry explicitly later.', new Date(this.blockedUntil));
      for (let attempt = 0; attempt < 3; attempt++) {
        const reservation = await this.admission?.reserve();
        const wait = Math.max(reservation?.waitMs ?? 0, this.nextRequest - this.now().getTime(), 0);
        if (wait) await this.sleep(wait);
        if (this.stopped) throw new ProviderError(503, 'PROVIDER_UNAVAILABLE', 'SEC synchronization has stopped.');
        this.nextRequest = this.now().getTime() + Math.ceil(1000 / this.config.SEC_EDGAR_MAX_RPS);
        const controller = new AbortController(); this.controllers.add(controller);
        const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
        let bytes = 0;
        let complete = false;
        try {
          const response = await this.fetcher(url, { headers: { 'User-Agent': this.config.SEC_EDGAR_USER_AGENT!, Accept: 'application/json' }, redirect: 'error', signal: controller.signal });
          if (response.status === 429 || response.status === 403) {
            await response.body?.cancel();
            const header = response.headers.get('retry-after');
            const seconds = header && /^\d+$/.test(header) ? Number(header) : undefined;
            const until = seconds !== undefined ? this.now().getTime() + seconds * 1000 : header ? Date.parse(header) : NaN;
            this.blockedUntil = Number.isFinite(until) ? Math.max(until, this.now().getTime() + 1000) : this.now().getTime() + 60_000;
            throw new ProviderError(429, 'PROVIDER_RATE_LIMITED', 'SEC fair-access limit or access block encountered. Retry explicitly after cooldown.', new Date(this.blockedUntil));
          }
          if (response.status === 404) { await response.body?.cancel(); throw new ProviderError(422, 'PROVIDER_NO_DATA', 'SEC data is unavailable for this issuer.'); }
          if (response.status >= 400 && response.status < 500 && response.status !== 408) { await response.body?.cancel(); throw secInvalid(); }
          if (!response.ok) { await response.body?.cancel(); throw new ProviderError(502, 'PROVIDER_UNAVAILABLE', 'SEC data is temporarily unavailable.'); }
          const reader = response.body?.getReader();
          if (!reader) throw secInvalid();
          const chunks: Uint8Array[] = [];
          while (true) {
            const read = await reader.read(); if (read.done) break;
            bytes += read.value.length;
            if (bytes > 32 * 1024 * 1024) { await reader.cancel(); throw secInvalid(); }
            chunks.push(read.value);
          }
          let payload: unknown;
          try { payload = parseProviderJson(Buffer.concat(chunks).toString('utf8')); } catch { throw secInvalid(); }
          if (reservation) await this.admission!.complete(reservation.id, bytes);
          complete = true;
          if (this.cache.size >= 32) this.cache.delete(this.cache.keys().next().value!);
          this.cache.set(url, { until: this.now().getTime() + ttl, payload });
          return payload;
        } catch (error) {
          const failure = error instanceof ProviderError ? error : new ProviderError(502, 'PROVIDER_UNAVAILABLE', 'SEC request timed out or failed. Saved data has been preserved.');
          if (reservation && !complete) await this.admission!.complete(reservation.id, bytes, failure.code, failure.retryAfter);
          if (this.stopped || failure.code !== 'PROVIDER_UNAVAILABLE' || attempt === 2) throw failure;
        } finally { clearTimeout(timeout); this.controllers.delete(controller); }
        await this.sleep(250 * 2 ** attempt);
      }
      throw secInvalid();
    };
    const result = this.queue.then(action, action); this.queue = result.catch(() => {}); return result;
  }
  async resolveTicker(symbol: string, exchange: string): Promise<SecIdentity> {
    const canonical = canonicalSymbol(symbol);
    const index = normalizeTickerIndex(await this.json('https://www.sec.gov/files/company_tickers_exchange.json', 24 * 60 * 60_000));
    const aliases: Record<string, string> = { 'NYSE ARCA': 'NYSE', 'NYSE MKT': 'NYSE', 'NYSE AMERICAN': 'NYSE', AMEX: 'NYSE' };
    const candidates = index.filter((item) => item.symbol === canonical && item.exchange === (aliases[exchange] ?? exchange));
    const ciks = new Set(candidates.map((item) => item.cik));
    if (ciks.size > 1) throw new ProviderError(409, 'AMBIGUOUS_SYMBOL', 'SEC ticker identity is ambiguous.');
    if (ciks.size === 0) throw new ProviderError(422, 'PROVIDER_NO_DATA', 'SEC has no matching current ticker and exchange.');
    return candidates[0]!;
  }
  async retrieve(symbol: string, exchange: string, knownCik?: string): Promise<SecBundle> {
    const identity = await this.resolveTicker(symbol, exchange);
    if (knownCik && identity.cik !== knownCik) throw new ProviderError(409, 'SYNC_CONFLICT', 'SEC CIK changed; saved issuer identity requires review.');
    const submissions = z.object({ cik: z.coerce.string(), name: z.string(), tickers: z.array(z.string()), exchanges: z.array(z.string()),
      filings: z.object({ recent: z.unknown(), files: z.array(z.object({ name: z.string(), filingFrom: z.string(), filingTo: z.string() })) })
    }).safeParse(await this.json(`https://data.sec.gov/submissions/CIK${identity.cik}.json`));
    if (!submissions.success || submissions.data.cik.padStart(10, '0') !== identity.cik || submissions.data.tickers.length !== submissions.data.exchanges.length) throw secInvalid();
    if (!submissions.data.tickers.some((ticker, i) => {
      try { return canonicalSymbol(ticker) === identity.symbol && submissions.data.exchanges[i]?.toUpperCase() === identity.exchange; } catch { return false; }
    })) throw new ProviderError(409, 'SYNC_CONFLICT', 'SEC directory and issuer submissions disagree on listing identity.');
    const all = normalizeFilings(submissions.data.filings.recent, identity.cik);
    // Refuse to claim full coverage if an unusually large history exceeds the bound.
    if (submissions.data.filings.files.length > 100) throw secInvalid();
    for (const file of submissions.data.filings.files) {
      if (!new RegExp(`^CIK${identity.cik}-submissions-\\d{3}\\.json$`).test(file.name)) throw secInvalid();
      all.push(...normalizeFilings(await this.json(`https://data.sec.gov/submissions/${file.name}`), identity.cik));
    }
    const filings = new Map<string, NormalizedFiling>();
    for (const row of all) {
      const old = filings.get(row.accessionNumber);
      if (old && JSON.stringify({ ...old, acceptedAt: null }) !== JSON.stringify({ ...row, acceptedAt: null })) throw secInvalid();
      filings.set(row.accessionNumber, old?.acceptedAt ? old : row);
    }
    const facts = normalizeCompanyFacts(await this.json(`https://data.sec.gov/api/xbrl/companyfacts/CIK${identity.cik}.json`), identity.cik, submissions.data.tickers.length);
    // Never invent filing publication metadata from a fact-only accession.
    if (facts.some((fact) => !filings.has(fact.accessionNumber) || filings.get(fact.accessionNumber)!.filedDate !== fact.context.filed || filings.get(fact.accessionNumber)!.form !== fact.context.form)) throw secInvalid();
    return { identity, filings: [...filings.values()], facts, historyComplete: true, issuerTickerCount: submissions.data.tickers.length, retrievedAt: this.now() };
  }
}
