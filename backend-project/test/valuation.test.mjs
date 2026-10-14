import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ValuationEngine, valuationSchema, marginOfSafety, distanceToEntry } from '../dist/services/valuation-engine.js';
import { calculateSnapshot } from '../dist/services/valuation.js';

export const cutoff = '2026-04-01T12:00:00.000Z';
const factId = '00000000-0000-4000-8000-000000000001';
const engine = new ValuationEngine();
const common = { entry: { mode: 'MARGIN', minimumSafety: '20', maximumSafety: '40' }, hypotheticalPrice: '70' };
function input(c = { method: 'DIRECT', fairValue: '100', rationale: 'Explicit test-only estimate', ...common }) { return { exchange: 'NASDAQ', cutoff, cases: { bear: structuredClone(c), base: structuredClone(c), bull: structuredClone(c) } }; }
function snapshot() { return { cutoff, instrument: { id: 'test-only', exchange: 'NASDAQ', symbol: 'TEST', currency: 'USD' }, price: { id: 'price-only', close: '90', tradingDate: '2026-03-30', retrievedAt: '2026-03-31T10:00:00.000Z', revision: 1, sourceHash: 'a'.repeat(64), provider: 'TIINGO', adjustmentMode: 'RAW', currency: 'USD', stale: false }, facts: [{ id: factId, metric: 'EPS', value: '5', unit: 'USD/shares', periodStart: '2025-01-01', periodEnd: '2025-12-31', availableAt: '2026-02-01T12:00:00.000Z', retrievedAt: '2026-02-02T12:00:00.000Z', accessionNumber: 'test-only', sourceUrl: 'https://www.sec.gov/Archives/test-only', concept: 'EarningsPerShareDiluted', issuerTickerCount: 1 }] }; }
function forecast(method = 'PE') { return { method, factId, growthPercent: '10', horizonYears: 2, targetMultiple: '20', discountPercent: '10', shareBasisNote: 'Test assumption: constant comparable share basis', ...common, ...(method === 'PS' ? { forecastShares: '100' } : {}) }; }
test('MOS, premium and entry boundary signs are independently hand-checkable', () => {
  const r = engine.calculate(input(), snapshot()).cases[1];
  assert.equal(r.fairValue, '100'); assert.deepEqual(r.entryZone, { lower: '60', upper: '80', mode: 'MARGIN' });
  assert.equal(r.currentPriceMarginOfSafetyPercent, '10'); assert.equal(r.currentPricePremiumPercent, '-10');
  assert.deepEqual(r.plannedEntryMarginOfSafetyPercent, { atLower: '40', atUpper: '20' });
  assert.equal(r.hypotheticalMarginOfSafetyPercent, '30'); assert.equal(r.distanceToEntryPercent, '12.5');
  assert.equal(distanceToEntry('50', '60', '80'), '-16.666666666667');
  for (const p of ['60', '70', '80']) assert.equal(distanceToEntry(p, '60', '80'), '0');
  assert.equal(marginOfSafety('100', '120'), '-20');
});
test('P/E projects 5 × 1.1² = 6.05; terminal 121 discounted by 1.1² = 100', () => {
  const r = engine.calculate(input(forecast()), snapshot()).cases[1];
  assert.equal(r.projectedMetric, '6.05'); assert.equal(r.terminalPrice, '121'); assert.equal(r.fairValue, '100');
});
test('P/S uses equity sales multiple and explicit forecast shares, not enterprise value', () => {
  const s = snapshot(); s.facts[0] = { ...s.facts[0], metric: 'REVENUE', unit: 'USD', value: '1000', concept: 'Revenues' };
  const c = { ...forecast('PS'), targetMultiple: '2', discountPercent: '0' };
  const r = engine.calculate(input(c), s).cases[0];
  assert.equal(r.projectedMetric, '1210'); assert.equal(r.terminalPrice, '24.2'); assert.equal(r.fairValue, '24.2');
});
test('zero horizon, negative growth, manual entry above fair value and null price are explicit', () => {
  const s = snapshot(); s.price = null;
  const c = { ...forecast(), horizonYears: 0, growthPercent: '-50', discountPercent: '100', entry: { mode: 'MANUAL', lower: '110', upper: '120' }, hypotheticalPrice: null };
  const r = engine.calculate(input(c), s).cases[1];
  assert.equal(r.fairValue, '100'); assert.equal(r.currentPriceMarginOfSafetyPercent, null); assert.equal(r.distanceToEntryPercent, null);
  assert.equal(r.plannedEntryMarginOfSafetyPercent.atUpper, '-20'); assert.equal(r.hypotheticalMarginOfSafetyPercent, null);
  c.horizonYears = 1; c.discountPercent = '0'; assert.equal(engine.calculate(input(c), s).cases[1].fairValue, '50');
});
test('negative/zero earnings and null facts never produce a positive P/E valuation', () => {
  for (const value of ['-5', '0']) { const s = snapshot(); s.facts[0].value = value; assert.throws(() => engine.calculate(input(forecast()), s), /positive annual diluted EPS/); }
  const s = snapshot(); s.facts = []; assert.throws(() => engine.calculate(input(forecast()), s), /missing/);
  assert.equal(engine.calculate(input(), s).cases[1].fairValue, '100');
});
test('invalid rates, nondecimal numeric JSON, impossible inputs and inverted cases are rejected', () => {
  for (const patch of [{ discountPercent: '-1' }, { discountPercent: '101' }, { growthPercent: '-100' }, { horizonYears: 1.5 }, { targetMultiple: '0' }, { targetMultiple: 20 }, { targetMultiple: '1e3' }, { shareBasisNote: '' }]) assert.equal(valuationSchema.safeParse(input({ ...forecast(), ...patch })).success, false);
  assert.equal(valuationSchema.safeParse(input({ ...forecast('PS'), forecastShares: '0' })).success, false);
  for (const entry of [{ mode: 'MARGIN', minimumSafety: '100', maximumSafety: '100' }, { mode: 'MANUAL', lower: '50', upper: '40' }]) assert.equal(valuationSchema.safeParse(input({ ...forecast(), entry })).success, false);
  const i = input(); i.cases.bear.fairValue = '101'; assert.throws(() => engine.calculate(i, snapshot()), /Bear/);
  assert.throws(() => engine.calculate(input({ ...forecast(), growthPercent: '1000', horizonYears: 30 }), snapshot()), /precision/);
});
test('source consistency rejects currency, quarterly/YTD periods, later publications, retrievals and stale annual inputs', () => {
  for (const patch of [{ unit: 'EUR/shares' }, { metric: 'REVENUE' }, { issuerTickerCount: 2 }, { periodStart: '2025-10-01' }, { periodStart: '2025-04-01' }, { availableAt: '2026-04-02T00:00:00.000Z' }, { retrievedAt: '2026-04-02T00:00:00.000Z' }, { periodStart: '2023-01-01', periodEnd: '2023-12-31' }]) {
    const s = snapshot(); Object.assign(s.facts[0], patch); assert.throws(() => engine.calculate(input(forecast()), s), { status: 422 });
  }
  for (const patch of [{ currency: 'EUR' }, { adjustmentMode: 'TOTAL_RETURN' }, { provider: 'OTHER' }, { retrievedAt: '2026-04-02T00:00:00.000Z' }, { tradingDate: '2026-04-01' }]) { const s = snapshot(); Object.assign(s.price, patch); assert.throws(() => engine.calculate(input(), s), { status: 422 }); }
});
test('precision remains exact through JSON serialization and replay; rounding is half-up at 8 places', () => {
  const i = input(); for (const c of Object.values(i.cases)) { c.fairValue = '9007199254740993.123456785'; c.entry = { mode: 'MANUAL', lower: '1', upper: '2' }; }
  const a = calculateSnapshot(i, snapshot()), b = calculateSnapshot(JSON.parse(JSON.stringify(i)), JSON.parse(JSON.stringify(snapshot())));
  assert.deepEqual(a, b); assert.equal(a.result.cases[1].fairValue, '9007199254740993.12345679');
  assert.equal(JSON.parse(JSON.stringify(a)).result.cases[1].fairValue, '9007199254740993.12345679');
  const changed = snapshot(); changed.price.close = '91'; assert.notEqual(calculateSnapshot(i, changed).hash, a.hash);
});
