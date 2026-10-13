import { z } from 'zod';
import { HttpError, type ErrorCode } from '../utils/http-error.js';

export const symbolSchema = z.string().trim().toUpperCase().max(32)
  .regex(/^[A-Z][A-Z0-9]*(?:[.-][A-Z0-9]+)*$/)
  .transform((value) => value.replaceAll('.', '-'));
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
});

export interface NormalizedInstrument {
  symbol: string;
  providerSymbol: string;
  exchange: string;
  name: string;
  currency: string;
  exchangeTimezone: string;
  availableFrom: string;
  availableThrough: string;
}

export type MarketProviderName = 'TIINGO';

export interface NormalizedPrice {
  tradingDate: string;
  timestamp: Date;
  provider: MarketProviderName;
  interval: 'DAY';
  adjustmentMode: 'RAW' | 'TOTAL_RETURN';
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  dividendCash: string | null;
  splitFactor: string | null;
  retrievedAt: Date;
  sourceHash: string;
  sourceData: Record<string, string | null>;
}

export interface MarketDataProvider {
  readonly name: MarketProviderName;
  readonly configured: boolean;
  searchInstruments?(query: string): Promise<{ symbol: string; name: string }[]>;
  resolveInstrument(symbol: string): Promise<NormalizedInstrument>;
  getDailyHistory(symbol: string, from: string, to: string): Promise<NormalizedPrice[]>;
  getLatestEod(symbol: string): Promise<NormalizedPrice[]>;
  shutdown?(): void;
}

export class ProviderError extends HttpError {
  constructor(status: number, code: ErrorCode, message: string, public readonly retryAfter?: Date) {
    super(status, code, message);
  }
}

export const invalidPayload = () => new ProviderError(502, 'PROVIDER_INVALID_RESPONSE', 'Tiingo returned invalid or incomplete daily data. Saved data has been preserved.');
export function canonicalSymbol(input: string): string {
  const parsed = symbolSchema.safeParse(input);
  if (!parsed.success) throw new ProviderError(400, 'INVALID_SYMBOL', 'Invalid stock symbol.');
  return parsed.data;
}
export function dateKey(date: Date): string { return date.toISOString().slice(0, 10); }
export function dateValue(value: string): Date { return new Date(`${dateSchema.parse(value)}T00:00:00Z`); }
export function shiftDate(value: string, days: number): string {
  const date = dateValue(value);
  date.setUTCDate(date.getUTCDate() + days);
  return dateKey(date);
}
