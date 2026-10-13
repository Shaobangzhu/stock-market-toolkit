import { createHash } from 'node:crypto';
import { z } from 'zod';
import { Prisma } from '../generated/prisma/client.js';
import { canonicalSymbol, dateSchema, ProviderError } from './market-data.js';

export const secInvalid = () => new ProviderError(502, 'PROVIDER_INVALID_RESPONSE', 'SEC returned invalid or incomplete data. Saved records have been preserved.');
export const secHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const accession = z.string().regex(/^\d{10}-\d{2}-\d{6}$/);
const cikSchema = z.union([z.string().regex(/^\d{1,10}$/).refine((value) => Number(value) > 0), z.number().int().positive()]).transform((value) => String(value).padStart(10, '0'));
export const forms = ['10-K', '10-K/A', '10-Q', '10-Q/A', '8-K', '8-K/A'] as const;
export const concepts = {
  revenue: ['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'SalesRevenueNet'],
  netIncome: ['NetIncomeLoss', 'ProfitLoss'],
  eps: ['EarningsPerShareDiluted'],
  operatingCashFlow: ['NetCashProvidedByUsedInOperatingActivities'],
  capitalExpenditures: ['PaymentsToAcquirePropertyPlantAndEquipment'],
  cashAndEquivalents: ['CashAndCashEquivalentsAtCarryingValue'],
  totalDebt: ['LongTermDebtAndFinanceLeaseObligationsIncludingCurrentPortion', 'LongTermDebtCurrent', 'LongTermDebtNoncurrent', 'LongTermDebt', 'ShortTermBorrowings'],
  operatingIncome: ['OperatingIncomeLoss'],
  sharesOutstanding: ['EntityCommonStockSharesOutstanding'],
} as const;
const supported = new Set(Object.values(concepts).flat());
export interface SecIdentity { cik: string; name: string; symbol: string; exchange: string }
export interface NormalizedFiling {
  accessionNumber: string; form: string; filedDate: string; acceptedAt: string | null;
  reportPeriod: string | null; primaryDocumentUrl: string; isAmendment: boolean;
}
export interface NormalizedFact {
  accessionNumber: string; taxonomy: string; concept: string; unit: string; value: string;
  periodStart: string | null; periodEnd: string; fiscalYear: number | null; fiscalPeriod: string | null;
  contextHash: string; context: { frame: string | null; filed: string; form: string; periodKind: string; issuerTickerCount: number; version: number; sourceValue: string };
}
export function normalizeTickerIndex(payload: unknown): SecIdentity[] {
  const schema = z.object({ fields: z.array(z.string()), data: z.array(z.array(z.union([z.string(), z.number(), z.null()]))).max(100000) });
  const parsed = schema.safeParse(payload);
  if (!parsed.success) throw secInvalid();
  const positions = ['cik', 'name', 'ticker', 'exchange'].map((key) => parsed.data.fields.indexOf(key));
  if (positions.some((index) => index < 0) || new Set(parsed.data.fields).size !== parsed.data.fields.length) throw secInvalid();
  return parsed.data.data.map((row) => {
    if (row.length !== parsed.data.fields.length) throw secInvalid();
    const [cik, name, ticker, exchange] = positions.map((i) => row[i]);
    if (!cikSchema.safeParse(cik).success || typeof name !== 'string' || !name || name.length > 256) throw secInvalid();
    if (ticker === null || exchange === null) return null;
    if (typeof ticker !== 'string' || typeof exchange !== 'string') throw secInvalid();
    // Unsupported ticker formats elsewhere in the SEC directory need not invalidate the directory.
    let symbol: string;
    try { symbol = canonicalSymbol(ticker); } catch { return null; }
    return { cik: cikSchema.parse(cik), name, symbol, exchange: exchange.toUpperCase() };
  }).filter((value): value is SecIdentity => value !== null);
}
export function filingUrl(cik: string, acc: string, document?: string) {
  const base = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${acc.replaceAll('-', '')}/`;
  return document ? `${base}${document.split('/').map(encodeURIComponent).join('/')}` : `${base}${acc}-index.html`;
}
export function normalizeFilings(payload: unknown, cik: string): NormalizedFiling[] {
  if (!payload || typeof payload !== 'object') throw secInvalid();
  const input = payload as Record<string, unknown>;
  const columns = ['accessionNumber', 'form', 'filingDate', 'reportDate', 'primaryDocument'] as const;
  if (columns.some((key) => !Array.isArray(input[key]))) throw secInvalid();
  const count = (input.accessionNumber as unknown[]).length;
  if (count > 100000 || columns.some((key) => (input[key] as unknown[]).length !== count)
    || (input.acceptanceDateTime !== undefined && (!Array.isArray(input.acceptanceDateTime) || input.acceptanceDateTime.length !== count))) throw secInvalid();
  const result: NormalizedFiling[] = [];
  for (let index = 0; index < count; index++) {
    const get = (key: string) => (input[key] as unknown[] | undefined)?.[index];
    const form = get('form');
    if (typeof form !== 'string') throw secInvalid();
    if (!(forms as readonly string[]).includes(form)) continue;
    const acc = get('accessionNumber'), filed = get('filingDate'), period = get('reportDate'), doc = get('primaryDocument'), accepted = get('acceptanceDateTime');
    if (!accession.safeParse(acc).success || !dateSchema.safeParse(filed).success || (period !== '' && !dateSchema.safeParse(period).success)
      || typeof doc !== 'string' || doc.length > 512 || doc.split('/').some((part) => !/^[A-Za-z0-9_.-]+$/.test(part) || part === '..' || part === '.') && doc !== '') throw secInvalid();
    let acceptedAt: string | null = null;
    if (accepted !== undefined && accepted !== null && accepted !== '') {
      if (typeof accepted !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(accepted) || !Number.isFinite(Date.parse(accepted))) throw secInvalid();
      acceptedAt = new Date(accepted).toISOString();
      if (acceptedAt.slice(0, 10) < String(filed)) throw secInvalid();
    }
    result.push({ accessionNumber: String(acc), form, filedDate: String(filed), acceptedAt, reportPeriod: period ? String(period) : null,
      primaryDocumentUrl: filingUrl(cik, String(acc), doc), isAmendment: form.endsWith('/A') });
  }
  return result;
}
const factSchema = z.object({
  val: z.string().max(100).regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/),
  accn: accession, start: dateSchema.optional(), end: dateSchema, filed: dateSchema,
  form: z.string(), fy: z.coerce.number().int().min(1900).max(2200).optional(), fp: z.string().max(8).optional(), frame: z.string().max(128).optional(),
});
export function periodKind(start: string | null, end: string): string {
  if (!start) return 'INSTANT';
  const days = (Date.parse(end) - Date.parse(start)) / 86400000 + 1;
  if (days >= 330 && days <= 400) return 'ANNUAL';
  if (days >= 70 && days <= 110) return 'QUARTER';
  if (days > 110 && days < 330) return 'YTD';
  return 'OTHER';
}
export function normalizeCompanyFacts(payload: unknown, cik: string, tickerCount: number): NormalizedFact[] {
  const parsed = z.object({ cik: cikSchema, entityName: z.string(), facts: z.record(z.string(), z.record(z.string(), z.object({ units: z.record(z.string(), z.array(z.unknown())) }))) }).safeParse(payload);
  if (!parsed.success || parsed.data.cik !== cik) throw secInvalid();
  const result = new Map<string, NormalizedFact>();
  for (const taxonomy of ['us-gaap', 'dei']) {
    for (const [concept, data] of Object.entries(parsed.data.facts[taxonomy] ?? {})) {
      if (!supported.has(concept as never) || (taxonomy === 'dei') !== (concept === 'EntityCommonStockSharesOutstanding')) continue;
      for (const [unit, values] of Object.entries(data.units)) {
        if (unit.length > 64) throw secInvalid();
        for (const input of values) {
          const row = factSchema.safeParse(input);
          if (!row.success) throw secInvalid();
          const r = row.data;
          if (!(forms as readonly string[]).includes(r.form)) continue;
          if (r.start && r.start > r.end || r.end > r.filed) throw secInvalid();
          const exponent = r.val.split(/[eE]/)[1];
          if (exponent && Math.abs(Number(exponent)) > 100) throw secInvalid();
          const decimal = new Prisma.Decimal(r.val);
          if (!decimal.isFinite() || decimal.abs().gte(new Prisma.Decimal(10).pow(26)) || decimal.decimalPlaces() > 12) throw secInvalid();
          const value = decimal.toFixed();
          const context = { frame: r.frame ?? null, filed: r.filed, form: r.form, periodKind: periodKind(r.start ?? null, r.end), issuerTickerCount: tickerCount, version: 1, sourceValue: r.val };
          // Value is part of the immutable observation identity: corrections never erase prior observations.
          // Frame/fy/fp are disclosure hints, not additional amounts to sum.
          const contextHash = secHash({ start: r.start ?? null, end: r.end, value });
          const fact = { accessionNumber: r.accn, taxonomy, concept, unit, value, periodStart: r.start ?? null, periodEnd: r.end,
            fiscalYear: r.fy ?? null, fiscalPeriod: r.fp ?? null, contextHash, context };
          const key = `${r.accn}:${taxonomy}:${concept}:${unit}:${contextHash}`;
          result.set(key, fact);
          if (result.size > 100000) throw secInvalid();
        }
      }
    }
  }
  return [...result.values()];
}
