import { randomUUID } from 'node:crypto';
import type { PrismaClient, Prisma } from '../generated/prisma/client.js';
import { ProviderError, dateValue } from '../providers/market-data.js';
import type { SecAdmission, SecBundle } from '../providers/sec-edgar.js';

export function secAdmission(db: PrismaClient, maxRps: number, now = () => new Date()): SecAdmission {
  return {
    async reserve() {
      return db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(70011203)`;
        const latest = await tx.providerRequestUsage.findFirst({ where: { provider: 'SEC_EDGAR' }, orderBy: { requestedAt: 'desc' } });
        const cooldown = await tx.providerRequestUsage.findFirst({ where: { provider: 'SEC_EDGAR', retryAfter: { gt: now() } }, orderBy: { retryAfter: 'desc' } });
        if (cooldown) throw new ProviderError(429, 'PROVIDER_RATE_LIMITED', 'SEC access is cooling down. Retry explicitly later.', cooldown.retryAfter!);
        const at = new Date(Math.max(now().getTime(), (latest?.requestedAt.getTime() ?? 0) + Math.ceil(1000 / maxRps)));
        const row = await tx.providerRequestUsage.create({ data: { provider: 'SEC_EDGAR', symbol: 'SEC_REQUEST', requestedAt: at, responseBytes: 0n } });
        return { id: row.id, waitMs: Math.max(0, at.getTime() - now().getTime()) };
      });
    },
    async complete(id, bytes, errorCode, retryAfter) {
      await db.providerRequestUsage.update({ where: { id }, data: { responseBytes: BigInt(bytes), errorCode: errorCode ?? null, retryAfter: retryAfter ?? null } });
    },
  };
}

export async function persistSecBundle(tx: Prisma.TransactionClient, instrumentId: string, bundle: SecBundle) {
  const issuer = await tx.issuer.upsert({ where: { cik: bundle.identity.cik }, create: { cik: bundle.identity.cik, name: bundle.identity.name }, update: { name: bundle.identity.name } });
  const previousFilings = await tx.secFiling.findMany({ where: { issuerId: issuer.id }, select: { accessionNumber: true } });
  const incomingFilings = new Set(bundle.filings.map((row) => row.accessionNumber));
  if (previousFilings.some((row) => !incomingFilings.has(row.accessionNumber))) throw new ProviderError(502, 'PROVIDER_INVALID_RESPONSE', 'SEC omitted previously stored filings. Saved data requires review and has been preserved.');
  const previousFacts = await tx.companyFact.findMany({ where: { issuerId: issuer.id }, select: { taxonomy: true, concept: true, unit: true, periodStart: true, periodEnd: true, filing: { select: { accessionNumber: true } } } });
  const logical = (acc: string, taxonomy: string, concept: string, unit: string, start: string | null, end: string) => JSON.stringify([acc, taxonomy, concept, unit, start, end]);
  const incomingFacts = new Set(bundle.facts.map((row) => logical(row.accessionNumber, row.taxonomy, row.concept, row.unit, row.periodStart, row.periodEnd)));
  if (previousFacts.some((row) => !incomingFacts.has(logical(row.filing.accessionNumber, row.taxonomy, row.concept, row.unit, row.periodStart?.toISOString().slice(0, 10) ?? null, row.periodEnd.toISOString().slice(0, 10))))) {
    throw new ProviderError(502, 'PROVIDER_INVALID_RESPONSE', 'SEC omitted previously stored fact contexts. Saved data requires review and has been preserved.');
  }
  await tx.instrument.update({ where: { id: instrumentId }, data: { issuerId: issuer.id } });
  const ids = new Map<string, string>();
  for (const row of bundle.filings) {
    const old = await tx.secFiling.findUnique({ where: { accessionNumber: row.accessionNumber } });
    if (old && (old.issuerId !== issuer.id || old.form !== row.form || old.filedDate.toISOString().slice(0, 10) !== row.filedDate
      || old.acceptedAt && row.acceptedAt && old.acceptedAt.toISOString() !== row.acceptedAt)) throw new ProviderError(409, 'SYNC_CONFLICT', 'SEC filing identity or publication metadata changed; saved records require review.');
    const data = { ...row, filedDate: dateValue(row.filedDate), reportPeriod: row.reportPeriod ? dateValue(row.reportPeriod) : null,
      acceptedAt: row.acceptedAt ? new Date(row.acceptedAt) : old?.acceptedAt ?? null, retrievedAt: bundle.retrievedAt };
    const filing = await tx.secFiling.upsert({ where: { accessionNumber: row.accessionNumber }, create: { ...data, issuerId: issuer.id }, update: data });
    ids.set(row.accessionNumber, filing.id);
  }
  for (let index = 0; index < bundle.facts.length; index += 500) {
    await tx.companyFact.createMany({ skipDuplicates: true, data: bundle.facts.slice(index, index + 500).map((row) => {
      const { accessionNumber, ...fact } = row;
      if (!ids.has(accessionNumber)) throw new ProviderError(502, 'PROVIDER_INVALID_RESPONSE', 'SEC fact has no verified filing.');
      return { id: randomUUID(), ...fact, issuerId: issuer.id, filingId: ids.get(accessionNumber)!, periodStart: row.periodStart ? dateValue(row.periodStart) : null,
        periodEnd: dateValue(row.periodEnd), retrievedAt: bundle.retrievedAt };
    }) });
  }
  return { issuerId: issuer.id, filingCount: bundle.filings.length, factCount: bundle.facts.length, historyComplete: bundle.historyComplete, issuerTickerCount: bundle.issuerTickerCount };
}
