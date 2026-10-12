import { createHash } from 'node:crypto';
import { z } from 'zod';
import { Prisma } from '../generated/prisma/client.js';
import { canonicalSymbol, dateSchema, dateValue, invalidPayload, ProviderError, type NormalizedInstrument, type NormalizedPrice } from './market-data.js';

// JSON.parse's source context preserves numeric lexemes on the supported Node runtime.
// No financial value passes through a JavaScript Number before persistence.
export function parseProviderJson(text: string): unknown {
  try {
    return JSON.parse(text, ((_key: string, value: unknown, context?: { source: string }) => {
      if (typeof value !== 'number') return value;
      if (!context?.source) throw invalidPayload();
      return context.source;
    }) as Parameters<typeof JSON.parse>[1]);
  } catch { throw invalidPayload(); }
}

const metadataSchema = z.object({
  ticker: z.string(), name: z.string().trim().min(1).max(256),
  exchangeCode: z.string().trim().min(1).max(32),
  startDate: dateSchema.nullable(), endDate: dateSchema.nullable(),
});
// Currency/timezone are an explicit initial US-market contract, not guessed from ticker.
const usExchanges = new Set(['NASDAQ', 'NYSE', 'NYSE ARCA', 'NYSE MKT', 'NYSE AMERICAN', 'AMEX', 'BATS', 'CBOE BZX', 'OTC', 'OTCQX', 'OTCQB', 'PINK']);
export function normalizeInstrument(payload: unknown, requestedSymbol: string): NormalizedInstrument {
  const parsed = metadataSchema.safeParse(payload);
  if (!parsed.success) throw invalidPayload();
  const data = parsed.data;
  const symbol = canonicalSymbol(data.ticker);
  if (symbol !== canonicalSymbol(requestedSymbol)) throw invalidPayload();
  const exchange = data.exchangeCode.toUpperCase();
  if (!usExchanges.has(exchange)) throw new ProviderError(422, 'UNSUPPORTED_INSTRUMENT', 'Only recognized US exchanges are supported by this Tiingo integration.');
  if (!data.startDate || !data.endDate) throw new ProviderError(422, 'PROVIDER_NO_DATA', 'Tiingo has no daily price coverage for this instrument.');
  if (data.startDate > data.endDate) throw invalidPayload();
  return { symbol, providerSymbol: symbol, exchange, name: data.name, currency: 'USD', exchangeTimezone: 'America/New_York', availableFrom: data.startDate, availableThrough: data.endDate };
}

const numeric = z.string().max(100).regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/)
  .refine((value) => { const exponent = value.split(/[eE]/)[1]; return exponent === undefined || Math.abs(Number(exponent)) <= 100; });
const optionalNumeric = numeric.nullable().optional();
const rowSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}T00:00:00(?:\.000)?(?:Z|\+00:00)$/),
  open: numeric, high: numeric, low: numeric, close: numeric, volume: numeric,
  adjOpen: optionalNumeric, adjHigh: optionalNumeric, adjLow: optionalNumeric,
  adjClose: optionalNumeric, adjVolume: optionalNumeric,
  divCash: optionalNumeric, splitFactor: optionalNumeric,
});
function decimal(value: string, precision: number, scale: number, integer = false): string {
  const exact = new Prisma.Decimal(value);
  if (!exact.isFinite() || exact.isNegative() || (integer && !exact.isInteger())) throw invalidPayload();
  const rounded = exact.toDecimalPlaces(scale, Prisma.Decimal.ROUND_HALF_UP);
  if (rounded.gte(new Prisma.Decimal(10).pow(precision - scale))) throw invalidPayload();
  return rounded.toFixed();
}
// Cross-products compare original adjustment ratios without division rounding.
// Precision exceeds the combined maximum lengths of two validated lexemes.
const BasisDecimal = Prisma.Decimal.clone({ precision: 256 });
export function adjustmentBasisChanged(old: Record<string, string | null>, current: Record<string, string | null>): boolean {
  if (!old.adjClose || !old.close || !old.adjVolume || !old.volume) return true;
  const priceChanged = !new BasisDecimal(old.adjClose).mul(current.close!).eq(new BasisDecimal(current.adjClose!).mul(old.close));
  const volumeChanged = !new BasisDecimal(old.volume).isZero() && !new BasisDecimal(current.volume!).isZero()
    && !new BasisDecimal(old.adjVolume).mul(current.volume!).eq(new BasisDecimal(current.adjVolume!).mul(old.volume));
  return priceChanged || volumeChanged;
}
export function normalizePrices(payload: unknown, retrievedAt: Date, range?: { from: string; to: string }): NormalizedPrice[] {
  if (!Array.isArray(payload) || payload.length > 20000) throw invalidPayload();
  const seen = new Set<string>();
  const result: NormalizedPrice[] = [];
  let adjustedAvailability: boolean | undefined;
  for (const input of payload) {
    const parsed = rowSchema.safeParse(input);
    if (!parsed.success) throw invalidPayload();
    const row = parsed.data;
    const day = row.date.slice(0, 10);
    if (!dateSchema.safeParse(day).success || seen.has(day) || (range && (day < range.from || day > range.to))) throw invalidPayload();
    // US daily trading observations cannot occur on Saturdays/Sundays.
    if ([0, 6].includes(dateValue(day).getUTCDay())) throw invalidPayload();
    seen.add(day);
    const adjusted = [row.adjOpen, row.adjHigh, row.adjLow, row.adjClose, row.adjVolume];
    const hasAdjusted = adjusted.every((value) => value != null);
    if (!hasAdjusted && adjusted.some((value) => value != null)) throw invalidPayload();
    if (adjustedAvailability !== undefined && adjustedAvailability !== hasAdjusted) throw invalidPayload();
    adjustedAvailability = hasAdjusted;
    // Capture only documented market fields; never retain arbitrary provider strings.
    const sourceData = Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value ?? null]));
    const dividendCash = row.divCash == null ? null : decimal(row.divCash, 24, 8);
    const splitFactor = row.splitFactor == null ? null : decimal(row.splitFactor, 30, 12);
    if (splitFactor === '0') throw invalidPayload();
    for (const adjustmentMode of hasAdjusted ? ['RAW', 'TOTAL_RETURN'] as const : ['RAW'] as const) {
      const fields = adjustmentMode === 'RAW' ? [row.open, row.high, row.low, row.close, row.volume] : adjusted as string[];
      // Check the exact original values before rounding to the storage scale.
      if (new Prisma.Decimal(fields[2]!).gt(Prisma.Decimal.min(fields[0]!, fields[3]!))
        || new Prisma.Decimal(fields[1]!).lt(Prisma.Decimal.max(fields[0]!, fields[3]!))
        || new Prisma.Decimal(fields[1]!).lt(fields[2]!)) throw invalidPayload();
      const [open, high, low, close, volume] = fields.map((value, index) => decimal(value!, index === 4 ? 30 : 24, 8, index === 4 && adjustmentMode === 'RAW'));
      if ([open, high, low, close].some((value) => new Prisma.Decimal(value!).lte(0))
        || new Prisma.Decimal(low!).gt(Prisma.Decimal.min(open!, close!))
        || new Prisma.Decimal(high!).lt(Prisma.Decimal.max(open!, close!))
        || new Prisma.Decimal(high!).lt(low!)) throw invalidPayload();
      result.push({ tradingDate: day, timestamp: dateValue(day), provider: 'TIINGO', interval: 'DAY', adjustmentMode,
        open: open!, high: high!, low: low!, close: close!, volume: volume!, dividendCash, splitFactor, retrievedAt,
        sourceData, sourceHash: createHash('sha256').update(JSON.stringify({ adjustmentMode, sourceData })).digest('hex') });
    }
  }
  return result.sort((a, b) => a.tradingDate.localeCompare(b.tradingDate) || a.adjustmentMode.localeCompare(b.adjustmentMode));
}
