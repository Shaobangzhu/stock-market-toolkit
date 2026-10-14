import { z } from 'zod';
import { Prisma } from '../generated/prisma/client.js';
import { HttpError } from '../utils/http-error.js';

const D = Prisma.Decimal.clone({ precision: 80, rounding: Prisma.Decimal.ROUND_HALF_UP });
export const FORMULA_VERSION = 'valuation-v1';
const decimal = z.string().max(48).regex(/^-?(0|[1-9]\d*)(\.\d{1,12})?$/);
const bounded = (min: string, max: string, exclusive = false) => decimal.refine(v => (exclusive ? new D(v).gt(min) : new D(v).gte(min)) && new D(v).lte(max));
const positive = bounded('0', '9999999999999999', true);
const percent = bounded('0', '99.999999999999');
const entry = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('MARGIN'), minimumSafety: percent, maximumSafety: percent }).refine(v => new D(v.minimumSafety).lte(v.maximumSafety), 'Minimum safety must not exceed maximum safety.'),
  z.strictObject({ mode: z.literal('MANUAL'), lower: positive, upper: positive }).refine(v => new D(v.lower).lte(v.upper), 'Entry lower bound must not exceed upper bound.'),
]);
const common = { entry, hypotheticalPrice: positive.nullable() };
const forecast = { factId: z.uuid(), growthPercent: bounded('-100', '1000', true), horizonYears: z.number().int().min(0).max(30), targetMultiple: bounded('0', '1000', true), discountPercent: bounded('0', '100'), shareBasisNote: z.string().trim().min(10).max(1000) };
export const caseSchema = z.discriminatedUnion('method', [
  z.strictObject({ method: z.literal('DIRECT'), fairValue: positive, rationale: z.string().trim().min(1).max(1000), ...common }),
  z.strictObject({ method: z.literal('PE'), ...forecast, ...common }),
  z.strictObject({ method: z.literal('PS'), ...forecast, forecastShares: positive, ...common }),
]);
export const valuationSchema = z.strictObject({
  exchange: z.string().trim().toUpperCase().min(1).max(32), cutoff: z.iso.datetime().transform(v => new Date(v).toISOString()),
  cases: z.strictObject({ bear: caseSchema, base: caseSchema, bull: caseSchema }),
});
export type ValuationAssumptions = z.infer<typeof valuationSchema>;
export interface ValuationFact {
  id: string; metric: 'EPS' | 'REVENUE'; value: string; unit: string; periodStart: string; periodEnd: string;
  availableAt: string; retrievedAt: string; accessionNumber: string; sourceUrl: string; concept: string; issuerTickerCount: number;
}
export interface ValuationSnapshot {
  instrument: { id: string; symbol: string; exchange: string; currency: string };
  cutoff: string;
  price: { id: string; close: string; tradingDate: string; retrievedAt: string; revision: number; sourceHash: string; provider: 'TIINGO'; adjustmentMode: 'RAW'; currency: string; stale: boolean } | null;
  facts: ValuationFact[];
}
const fail = (message: string): never => { throw new HttpError(422, 'VALUATION_UNAVAILABLE', message); };
function money(value: InstanceType<typeof D>) {
  const rounded = value.toDecimalPlaces(8);
  if (!rounded.isFinite() || rounded.lte(0) || rounded.gte('10000000000000000')) fail('Calculated price is outside supported precision.');
  return rounded.toFixed();
}
const output = (value: InstanceType<typeof D>) => value.toDecimalPlaces(12).toFixed();
export function marginOfSafety(fair: string, reference: string) {
  if (!decimal.safeParse(fair).success || !decimal.safeParse(reference).success || new D(fair).lte(0) || new D(reference).lt(0)) fail('Margin of safety requires positive fair value and a nonnegative reference price.');
  return output(new D(fair).minus(reference).div(fair).mul(100));
}
// Negative below lower boundary, zero inside inclusive zone, positive above upper.
export function distanceToEntry(price: string, lower: string, upper: string) {
  if (![price, lower, upper].every(v => decimal.safeParse(v).success) || new D(price).lt(0) || new D(lower).lte(0) || new D(upper).lt(lower)) fail('Distance requires a nonnegative price and an ordered positive entry zone.');
  const p = new D(price);
  return p.lt(lower) ? output(p.div(lower).minus(1).mul(100)) : p.gt(upper) ? output(p.div(upper).minus(1).mul(100)) : '0';
}
export class ValuationEngine {
  calculate(input: ValuationAssumptions, snapshot: ValuationSnapshot) {
    const assumptions = valuationSchema.parse(input);
    if (snapshot.cutoff !== assumptions.cutoff || snapshot.instrument.exchange !== assumptions.exchange) fail('Snapshot identity or cutoff differs from assumptions.');
    if (snapshot.price && (snapshot.price.currency !== snapshot.instrument.currency || snapshot.price.provider !== 'TIINGO' || snapshot.price.adjustmentMode !== 'RAW'
      || snapshot.price.retrievedAt > snapshot.cutoff || Date.parse(snapshot.price.tradingDate) + 29 * 3600000 > Date.parse(snapshot.cutoff))) fail('Price is not comparable or was unavailable at cutoff.');
    const results = (['bear', 'base', 'bull'] as const).map(name => {
      const c = assumptions.cases[name];
      let fair: string, projectedMetric: string | null = null, terminalPrice: string | null = null, source: ValuationFact | null = null;
      if (c.method === 'DIRECT') fair = money(new D(c.fairValue));
      else {
        source = snapshot.facts.find(f => f.id === c.factId) ?? null;
        if (!source) return fail('Selected SEC annual fact is missing, superseded, ambiguous, or unavailable at cutoff.');
        if (source.availableAt > snapshot.cutoff || source.retrievedAt > snapshot.cutoff || source.periodEnd > snapshot.cutoff.slice(0, 10)) fail('Financial fact was unavailable at cutoff.');
        const days = (Date.parse(source.periodEnd) - Date.parse(source.periodStart)) / 86400000;
        if (days < 329 || days > 385 || Date.parse(snapshot.cutoff) - Date.parse(source.periodEnd) > 550 * 86400000) fail('An annual reporting period no older than 550 days is required.');
        if (source.issuerTickerCount !== 1) fail('Multiple or unverified listed share classes require an explicit direct valuation.');
        if (source.metric !== (c.method === 'PE' ? 'EPS' : 'REVENUE') || source.unit !== `${snapshot.instrument.currency}${c.method === 'PE' ? '/shares' : ''}`) fail('Financial metric or currency does not match the selected method.');
        if (new D(source.value).lte(0)) fail(c.method === 'PE' ? 'P/E requires positive annual diluted EPS; negative or zero earnings are unsupported.' : 'P/S requires positive annual revenue.');
        const projected = new D(source.value).mul(new D(1).plus(new D(c.growthPercent).div(100)).pow(c.horizonYears));
        const terminal = projected.mul(c.targetMultiple).div(c.method === 'PS' ? c.forecastShares : '1');
        projectedMetric = output(projected); terminalPrice = output(terminal);
        fair = money(terminal.div(new D(1).plus(new D(c.discountPercent).div(100)).pow(c.horizonYears)));
      }
      const lower = c.entry.mode === 'MANUAL' ? money(new D(c.entry.lower)) : money(new D(fair).mul(new D(1).minus(new D(c.entry.maximumSafety).div(100))));
      const upper = c.entry.mode === 'MANUAL' ? money(new D(c.entry.upper)) : money(new D(fair).mul(new D(1).minus(new D(c.entry.minimumSafety).div(100))));
      const current = snapshot.price?.close ?? null;
      return { name, method: c.method, fairValue: fair, projectedMetric, terminalPrice, source,
        entryZone: { lower, upper, mode: c.entry.mode },
        currentPriceMarginOfSafetyPercent: current ? marginOfSafety(fair, current) : null,
        currentPricePremiumPercent: current ? output(new D(current).div(fair).minus(1).mul(100)) : null,
        plannedEntryMarginOfSafetyPercent: { atLower: marginOfSafety(fair, lower), atUpper: marginOfSafety(fair, upper) },
        hypotheticalMarginOfSafetyPercent: c.hypotheticalPrice ? marginOfSafety(fair, c.hypotheticalPrice) : null,
        distanceToEntryPercent: current ? distanceToEntry(current, lower, upper) : null };
    });
    const [bear, base, bull] = results;
    if (new D(bear!.fairValue).gt(base!.fairValue) || new D(base!.fairValue).gt(bull!.fairValue)) fail('Fair values must be ordered Bear ≤ Base ≤ Bull. Review the assumptions.');
    return { formulaVersion: FORMULA_VERSION, currency: snapshot.instrument.currency, cases: results,
      fairValueRange: { lower: bear!.fairValue, upper: bull!.fairValue },
      watchlistProjection: { version: 1, adjustmentMode: 'RAW', referenceTradingDate: snapshot.price?.tradingDate ?? snapshot.cutoff.slice(0, 10), fairValueLow: bear!.fairValue, fairValueHigh: bull!.fairValue },
      limitations: ['Model-derived estimates, not guaranteed returns.', 'Multiples value discounted terminal equity price only; interim dividends and cash flows are excluded.', 'Growth starts from the selected annual metric at the scenario cutoff; no automatic stub-period or TTM extrapolation.', 'Share basis and future share count are explicit user assumptions; no automatic split or dilution adjustment.', 'Current-price metrics refer to the saved EOD snapshot, which may be stale.', 'Historical inputs require both publication and local retrieval by cutoff; user assumptions are retrospective unless saved at that time.'] };
  }
}
