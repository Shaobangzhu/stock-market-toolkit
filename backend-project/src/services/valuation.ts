import { createHash, randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '../generated/prisma/client.js';
import { FORMULA_VERSION, ValuationEngine, type ValuationAssumptions, type ValuationSnapshot } from './valuation-engine.js';
import { valuationInstrument, readValuationSnapshot } from '../repositories/valuation.js';
import { HttpError } from '../utils/http-error.js';

export function calculationHash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
export function calculateSnapshot(assumptions: ValuationAssumptions, snapshot: ValuationSnapshot) {
  const ids = new Set(Object.values(assumptions.cases).flatMap(c => c.method === 'DIRECT' ? [] : [c.factId]));
  const inputSnapshot = { ...snapshot, facts: snapshot.facts.filter(f => ids.has(f.id)) };
  const result = new ValuationEngine().calculate(assumptions, inputSnapshot);
  const hash = calculationHash({ assumptions, inputSnapshot, result });
  return { assumptions, inputSnapshot, result, hash };
}
export function createValuationService(db: PrismaClient, now = () => new Date()) {
  function cutoffCheck(cutoff: string) {
    if (!Number.isFinite(Date.parse(cutoff)) || Date.parse(cutoff) > now().getTime() || Date.parse(cutoff) < Date.parse('1900-01-01')) throw new HttpError(400, 'VALIDATION_ERROR', 'Cutoff must be between 1900 and the present.');
  }
  const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  return {
    async sources(symbol: string, exchange: string, cutoff: string) {
      cutoffCheck(cutoff);
      return db.$transaction(tx => readValuationSnapshot(tx, symbol, exchange, cutoff), { isolationLevel: 'RepeatableRead' });
    },
    async list(symbol: string, exchange: string) {
      const instrument = await valuationInstrument(db, symbol, exchange);
      const rows = await db.entryScenario.findMany({ where: { instrumentId: instrument.id, methodVersion: FORMULA_VERSION }, orderBy: [{ createdAt: 'desc' }, { version: 'desc' }, { id: 'desc' }], take: 50 });
      return rows.map(row => ({ id: row.id, seriesId: row.seriesId, version: row.version, createdAt: row.createdAt.toISOString(), assumptions: row.assumptions,
        inputSnapshot: row.inputSnapshot, result: row.resultSnapshot, formulaVersion: row.methodVersion }));
    },
    async calculate(symbol: string, assumptions: ValuationAssumptions) {
      cutoffCheck(assumptions.cutoff);
      return db.$transaction(async tx => calculateSnapshot(assumptions, await readValuationSnapshot(tx, symbol, assumptions.exchange, assumptions.cutoff)), { isolationLevel: 'RepeatableRead' });
    },
    async save(symbol: string, assumptions: ValuationAssumptions, expectedHash: string, seriesId?: string, expectedVersion?: number) {
      cutoffCheck(assumptions.cutoff);
      return db.$transaction(async tx => {
        // Lock before reading so concurrent saves see the latest committed version.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(70011205)`;
        const snapshot = await readValuationSnapshot(tx, symbol, assumptions.exchange, assumptions.cutoff);
        const calculation = calculateSnapshot(assumptions, snapshot);
        if (calculation.hash !== expectedHash) throw new HttpError(409, 'VALUATION_CONFLICT', 'Source data changed. Calculate and review again before saving.');
        const previous = seriesId ? await tx.entryScenario.findFirst({ where: { seriesId, instrumentId: snapshot.instrument.id, methodVersion: FORMULA_VERSION }, orderBy: { version: 'desc' } }) : null;
        if (seriesId && (!previous || previous.version !== expectedVersion)) throw new HttpError(409, 'VALUATION_CONFLICT', 'Scenario version changed. Reload before saving a new version.');
        const base = calculation.result.cases[1]!;
        const row = await tx.entryScenario.create({ data: { instrumentId: snapshot.instrument.id, seriesId: seriesId ?? randomUUID(), version: (previous?.version ?? 0) + 1,
          method: 'BEAR_BASE_BULL', methodVersion: FORMULA_VERSION, inputSnapshot: json({ ...calculation.inputSnapshot, hash: calculation.hash }), assumptions: json(assumptions), resultSnapshot: json(calculation.result),
          currency: snapshot.instrument.currency, lowerPrice: base.entryZone.lower, upperPrice: base.entryZone.upper, dataCutoff: new Date(assumptions.cutoff), createdAt: now() } });
        return { id: row.id, seriesId: row.seriesId, version: row.version, createdAt: row.createdAt.toISOString(), ...calculation };
      }, { timeout: 20000 });
    },
  };
}
export type ValuationService = ReturnType<typeof createValuationService>;
