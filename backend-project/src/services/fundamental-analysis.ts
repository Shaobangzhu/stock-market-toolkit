import { Prisma } from '../generated/prisma/client.js';
import { concepts, periodKind } from '../providers/sec-normalization.js';

const Decimal = Prisma.Decimal.clone({ precision: 80 });
export interface FactObservation {
  id: string; concept: string; taxonomy: string; unit: string; value: string; periodStart: string | null; periodEnd: string;
  fiscalYear: number | null; fiscalPeriod: string | null; accessionNumber: string; filedDate: string; acceptedAt: string | null;
  availableAt: string; isAmendment: boolean; retrievedAt: string; sourceUrl: string; issuerTickerCount: number;
}
export interface Metric { value: string | null; unit: string; derived: boolean; reason: string | null; sources: FactObservation[]; method?: string }
const missing = (unit: string, reason = 'MISSING_COMPARABLE_FACT'): Metric => ({ value: null, unit, derived: false, reason, sources: [] });
function pick(rows: FactObservation[], names: readonly string[], unit: string): Metric {
  const candidates = rows.filter((row) => names.includes(row.concept) && row.unit === unit).sort((a, b) => b.availableAt.localeCompare(a.availableAt) || names.indexOf(a.concept) - names.indexOf(b.concept));
  const first = candidates[0];
  if (!first) return missing(unit);
  const rivals = candidates.filter((row) => row.availableAt === first.availableAt && row.concept === first.concept);
  if (new Set(rivals.map((row) => row.value)).size > 1) return missing(unit, 'AMBIGUOUS_DISCLOSURE');
  return { value: first.value, unit, derived: false, reason: null, sources: [first] };
}
function combine(a: Metric, b: Metric, unit: string, method: string, operation: (x: InstanceType<typeof Decimal>, y: InstanceType<typeof Decimal>) => InstanceType<typeof Decimal>, divisor = false): Metric {
  if (a.value === null || b.value === null) return { ...missing(unit), derived: true, method };
  const aa = a.sources[0]!, bb = b.sources[0]!;
  if (aa.accessionNumber !== bb.accessionNumber || aa.periodStart !== bb.periodStart || aa.periodEnd !== bb.periodEnd || a.unit !== b.unit) return { ...missing(unit, 'INCOMPARABLE_DISCLOSURES'), derived: true, method };
  if (divisor && new Decimal(b.value).lte(0)) return { ...missing(unit, 'NON_POSITIVE_DENOMINATOR'), derived: true, method };
  return { value: operation(new Decimal(a.value), new Decimal(b.value)).toDecimalPlaces(12).toFixed(), unit, derived: true, reason: null, sources: [...a.sources, ...b.sources], method };
}
export interface ValuationInput { close: string; currency: string; tradingDate: string; provider: 'TIINGO'; adjustmentMode: 'RAW'; shareBasisVerified: boolean; freshAtCutoff: boolean; issuerTickerCount: number }
export function analyzeFundamentals(observations: FactObservation[], currency: string, limit = 12, market?: ValuationInput) {
  const groups = new Map<string, FactObservation[]>();
  for (const row of observations) {
    const key = `${row.periodStart ?? 'instant'}:${row.periodEnd}`;
    const group = groups.get(key) ?? []; group.push(row); groups.set(key, group);
  }
  const periods = [...groups.values()].map((rows) => {
    const first = rows[0]!, kind = periodKind(first.periodStart, first.periodEnd);
    const instant = kind === 'INSTANT';
    const revenue = instant ? missing(currency) : pick(rows, concepts.revenue, currency);
    const netIncome = instant ? missing(currency) : pick(rows, concepts.netIncome, currency);
    const operatingIncome = instant ? missing(currency) : pick(rows, concepts.operatingIncome, currency);
    const operatingCashFlow = instant ? missing(currency) : pick(rows, concepts.operatingCashFlow, currency);
    const capitalExpenditures = instant ? missing(currency) : pick(rows, concepts.capitalExpenditures, currency);
    let freeCashFlow = combine(operatingCashFlow, capitalExpenditures, currency, 'operatingCashFlow - capitalExpenditures', (a, b) => a.minus(b));
    if (capitalExpenditures.value !== null && new Decimal(capitalExpenditures.value).lt(0)) freeCashFlow = { ...missing(currency, 'UNSUPPORTED_CAPEX_SIGN'), derived: true };
    // Do not call long-term debt alone total debt or assume absent short-term debt is zero.
    const short = pick(rows, ['ShortTermBorrowings'], currency);
    let debt = pick(rows, ['LongTermDebtAndFinanceLeaseObligationsIncludingCurrentPortion'], currency);
    if (debt.value === null) debt = combine(pick(rows, ['LongTermDebtCurrent'], currency), pick(rows, ['LongTermDebtNoncurrent'], currency), currency, 'current + noncurrent long-term debt', (a, b) => a.plus(b));
    const totalDebt = instant ? combine(debt, short, currency, 'long-term debt including current portion + short-term borrowings (excludes operating leases)', (a, b) => a.plus(b)) : missing(currency);
    let revenueGrowth: Metric = { ...missing('percent'), derived: true, method: 'year-over-year comparable reported revenue growth' };
    if (revenue.value !== null && !instant) {
      const selected = revenue.sources[0]!;
      const prior = [...groups.values()].filter((r) => {
        const p = r[0]!; const gap = (Date.parse(first.periodEnd) - Date.parse(p.periodEnd)) / 86400000;
        return p.periodStart && first.periodStart && gap >= 330 && gap <= 400 && periodKind(p.periodStart, p.periodEnd) === kind
          && Math.abs((Date.parse(first.periodEnd) - Date.parse(first.periodStart)) - (Date.parse(p.periodEnd) - Date.parse(p.periodStart))) <= 7 * 86400000;
      }).sort((a, b) => b[0]!.periodEnd.localeCompare(a[0]!.periodEnd));
      if (prior.length === 1) {
        const old = pick(prior[0]!, [selected.concept], currency);
        if (old.value !== null && new Decimal(old.value).gt(0)) revenueGrowth = { value: new Decimal(revenue.value).div(old.value).minus(1).mul(100).toDecimalPlaces(12).toFixed(), unit: 'percent', derived: true, reason: null, sources: [...revenue.sources, ...old.sources], method: 'year-over-year same-concept reported revenue growth' };
      }
    }
    return { periodStart: first.periodStart, periodEnd: first.periodEnd, periodKind: kind, currency,
      metrics: { revenue, netIncome, eps: instant ? missing(`${currency}/shares`) : pick(rows, concepts.eps, `${currency}/shares`), operatingCashFlow, capitalExpenditures, freeCashFlow,
        cashAndEquivalents: instant ? pick(rows, concepts.cashAndEquivalents, currency) : missing(currency), totalDebt, revenueGrowth,
        operatingMargin: combine(operatingIncome, revenue, 'percent', 'operatingIncome / revenue * 100', (a, b) => a.div(b).mul(100), true),
        netMargin: combine(netIncome, revenue, 'percent', 'netIncome / revenue * 100', (a, b) => a.div(b).mul(100), true) } };
  }).sort((a, b) => b.periodEnd.localeCompare(a.periodEnd) || a.periodKind.localeCompare(b.periodKind));
  const annual = periods.find((period) => period.periodKind === 'ANNUAL');
  let priceEarnings = { ...missing('ratio', 'MISSING_COMPARABLE_PRICE_AND_EPS'), derived: true, method: 'cached raw close / annual diluted EPS (not TTM)' };
  let priceSales = { ...missing('ratio', 'MISSING_COMPARABLE_MARKET_CAP'), derived: true, method: 'cached raw close * same-date shares outstanding / annual revenue (not TTM)' };
  let marketCapitalization = { ...missing(currency, 'MISSING_COMPARABLE_PRICE_AND_SHARES'), derived: true, method: 'cached raw close × same-date, published outstanding shares for a single listed class' };
  if (market && market.freshAtCutoff && market.currency === currency && market.issuerTickerCount === 1) {
    const shares = pick(observations.filter(row => !row.periodStart && row.periodEnd === market.tradingDate), concepts.sharesOutstanding, 'shares');
    if (shares.value !== null && new Decimal(shares.value).gt(0) && shares.sources[0]?.issuerTickerCount === 1 && shares.sources[0].availableAt.slice(0, 10) <= market.tradingDate) {
      marketCapitalization = { ...marketCapitalization, value: new Decimal(market.close).mul(shares.value).toFixed(), reason: null, sources: shares.sources };
    }
  }
  if (market && !market.freshAtCutoff) { priceEarnings.reason = 'STALE_MARKET_PRICE'; priceSales.reason = 'STALE_MARKET_PRICE'; }
  if (market && market.freshAtCutoff && annual && market.currency === currency && market.tradingDate >= annual.periodEnd
    && Date.parse(market.tradingDate) - Date.parse(annual.periodEnd) <= 450 * 86400000) {
    const eps = annual.metrics.eps;
    if (eps.value !== null && new Decimal(eps.value).lte(0)) priceEarnings.reason = 'NON_POSITIVE_EARNINGS';
    else if (!market.shareBasisVerified || market.issuerTickerCount !== 1 || eps.sources[0]?.issuerTickerCount !== 1) priceEarnings.reason = 'UNVERIFIED_SHARE_BASIS';
    else if (eps.sources[0] && market.tradingDate < eps.sources[0].availableAt.slice(0, 10)) priceEarnings.reason = 'PRICE_PRECEDES_DISCLOSURE';
    else if (eps.value !== null) priceEarnings = { ...priceEarnings, value: new Decimal(market.close).div(eps.value).toDecimalPlaces(12).toFixed(), reason: null, sources: eps.sources };
    const shares = pick(observations.filter((row) => !row.periodStart && row.periodEnd === market.tradingDate), concepts.sharesOutstanding, 'shares');
    if (shares.value !== null && market.issuerTickerCount === 1 && shares.sources[0]?.issuerTickerCount === 1 && shares.sources[0].availableAt.slice(0, 10) <= market.tradingDate && annual.metrics.revenue.value !== null
      && market.tradingDate >= annual.metrics.revenue.sources[0]!.availableAt.slice(0, 10) && new Decimal(shares.value).gt(0) && new Decimal(annual.metrics.revenue.value).gt(0)) {
      priceSales = { ...priceSales, value: new Decimal(market.close).mul(shares.value).div(annual.metrics.revenue.value).toDecimalPlaces(12).toFixed(), reason: null, sources: [...shares.sources, ...annual.metrics.revenue.sources] };
    }
  }
  return { methodVersion: 'sec-fundamentals-v1', periods: periods.slice(0, limit), valuation: { priceEarnings, priceSales, marketCapitalization, marketObservation: market ?? null } };
}
