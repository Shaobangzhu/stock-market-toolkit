import { Prisma, type PrismaClient } from '../generated/prisma/client.js';

export type ResearchKind = 'REPORT' | 'SCENARIO' | 'NOTE';
export interface HistoryQuery { symbol?: string; exchange?: string; trackedOnly?: boolean; search?: string; kind?: ResearchKind; from?: string; to?: string; limit: number; offset: number }
export interface HistoryRow { id: string; kind: ResearchKind; instrumentId: string; symbol: string; exchange: string; company: string; currency: string; seriesId: string; version: number; date: Date; cutoff: Date; summary: string | null; result: unknown; ordinal?: bigint }
export async function historyRows(db: PrismaClient, query: HistoryQuery, now: Date) {
  const filter = Prisma.sql`WHERE h.date <= ${now} AND h.cutoff <= ${now}
    ${query.symbol ? Prisma.sql`AND i.symbol = ${query.symbol}` : Prisma.empty}
    ${query.exchange ? Prisma.sql`AND i.exchange = ${query.exchange}` : Prisma.empty}
    ${query.trackedOnly ? Prisma.sql`AND EXISTS (SELECT 1 FROM "WatchlistEntry" w WHERE w."instrumentId" = i.id)` : Prisma.empty}
    ${query.kind ? Prisma.sql`AND h.kind = ${query.kind}` : Prisma.empty}
    ${query.search ? Prisma.sql`AND (strpos(lower(i.symbol || ' ' || i.name || ' ' || coalesce(h.summary,'') || ' ' || coalesce(h.result::text,'')), lower(${query.search})) > 0)` : Prisma.empty}
    ${query.from ? Prisma.sql`AND h.date >= ${new Date(query.from + 'T00:00:00Z')}` : Prisma.empty}
    ${query.to ? Prisma.sql`AND h.date < ${new Date(Date.parse(query.to + 'T00:00:00Z') + 86400000)}` : Prisma.empty}`;
  return db.$queryRaw<HistoryRow[]>(Prisma.sql`
    WITH history AS (
      SELECT id, 'REPORT'::text kind, "instrumentId", "seriesId", version, "completedAt" date, "dataCutoff" cutoff, output->>'summary' summary, output result
      FROM "ResearchRun" WHERE status = 'SUCCEEDED' AND "completedAt" IS NOT NULL
      UNION ALL
      SELECT s.id, 'SCENARIO', s."instrumentId", s."seriesId", s.version, s."createdAt", s."dataCutoff", s.method, s."resultSnapshot"
      FROM "EntryScenario" s LEFT JOIN "ResearchRun" r ON r.id = s."researchRunId" WHERE s."researchRunId" IS NULL OR (r.status = 'SUCCEEDED' AND r."completedAt" <= ${now})
      UNION ALL
      SELECT id, 'NOTE', "instrumentId", "seriesId", version, "createdAt", "createdAt", content, NULL::jsonb FROM "ResearchNote"
    ), ranked AS (
      SELECT *, row_number() OVER (PARTITION BY "instrumentId" ORDER BY date, version, kind, id) ordinal FROM history WHERE date <= ${now} AND cutoff <= ${now}
    )
    SELECT h.*, i.symbol, i.exchange, i.name company, i.currency FROM ranked h JOIN "Instrument" i ON i.id = h."instrumentId"
    ${filter} ORDER BY h.date DESC, h.version DESC, h.kind, h.id DESC LIMIT ${query.limit + 1} OFFSET ${query.offset}
  `);
}
