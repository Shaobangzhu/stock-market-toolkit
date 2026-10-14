import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Prisma, type PrismaClient } from '../generated/prisma/client.js';
import { historyRows, type HistoryQuery, type HistoryRow, type ResearchKind } from '../repositories/research-history.js';
import { canonicalSymbol } from '../providers/market-data.js';
import { valuationInstrument } from '../repositories/valuation.js';
import { HttpError } from '../utils/http-error.js';

const obj = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const str = (v: unknown) => typeof v === 'string' ? v : null;
const decimal = (v: unknown) => typeof v === 'string' && /^-?(0|[1-9]\d*)(\.\d+)?$/.test(v) ? v : null;
export function researchUrl(v: unknown) { try { const u = new URL(String(v)); if (u.protocol === 'https:' && !u.username && !u.password && !/^(localhost|127\.|10\.|192\.168\.|\[|0\.)/i.test(u.hostname)) return u.href; } catch { /* unavailable URL */ } return null; }
const types = { REPORT: 'AI Report', SCENARIO: 'Entry Scenario', NOTE: 'Manual Thesis / Note' } as const;
const range = (v: unknown, currency: string) => { const r = obj(v), lower = decimal(r.lower ?? r.fairValueLow), upper = decimal(r.upper ?? r.fairValueHigh); return lower && upper && new Prisma.Decimal(lower).gt(0) && new Prisma.Decimal(upper).gte(lower) ? { lower, upper, currency } : null; };
const noteData = (content: string) => { try { const value = obj(JSON.parse(content)); if (value.schemaVersion === 'research-note-v1') return value; } catch { /* legacy plain text note */ } return { content }; };
function summary(row: HistoryRow) {
  const output = obj(row.result), note = row.kind === 'NOTE' ? noteData(row.summary ?? '') : null;
  return { id: row.id, kind: row.kind, type: types[row.kind], instrumentId: row.instrumentId, symbol: row.symbol, exchange: row.exchange, company: row.company,
    seriesId: row.seriesId, version: row.version, completedAt: row.date.toISOString(), dataCutoff: row.cutoff.toISOString(), ...(row.ordinal ? { markerOrdinal: Number(row.ordinal) } : {}),
    fairValue: row.kind === 'SCENARIO' ? range(output.fairValueRange ?? output.watchlistProjection, row.currency) : null,
    summary: (str(note?.title) ?? str(note?.content) ?? row.summary ?? '').slice(0, 600) };
}
const points = (v: unknown): string[] => Array.isArray(v) ? v.flatMap(x => { const text = str(x) ?? str(obj(x).text); return text ? [text] : []; }).slice(0, 50) : [];
function savedPrice(input: unknown, currency: string) {
  const i = obj(input), p = obj(i.price ?? i.marketObservation ?? obj(i.stock).lastPrice);
  const value = decimal(p.close ?? p.value), tradingDate = str(p.tradingDate);
  return value && tradingDate ? { value, tradingDate, currency: str(p.currency) ?? currency, provider: str(p.provider), adjustmentMode: str(p.adjustmentMode), retrievedAt: str(p.retrievedAt), snapshotOnly: true } : null;
}
export const noteInputSchema = z.strictObject({ exchange: z.string().trim().toUpperCase().min(1).max(32), title: z.string().trim().min(1).max(160), content: z.string().trim().min(1).max(12000),
  risks: z.array(z.string().trim().min(1).max(1000)).max(10).default([]), catalysts: z.array(z.string().trim().min(1).max(1000)).max(10).default([]),
  seriesId: z.uuid().optional(), expectedVersion: z.number().int().positive().optional(), researchRunId: z.uuid().optional(),
}).refine(v => !!v.seriesId === !!v.expectedVersion, 'Provide series and expected version together.');
export function createResearchHistoryService(db: PrismaClient, now = () => new Date()) {
  async function list(query: HistoryQuery) {
    if (query.symbol) {
      const matches = await db.instrument.findMany({ where: { symbol: canonicalSymbol(query.symbol), ...(query.exchange ? { exchange: query.exchange } : {}) }, take: 2 });
      if (!matches.length) throw new HttpError(404, 'NOT_FOUND', 'Stock not found in local storage.');
      if (matches.length > 1) throw new HttpError(409, 'AMBIGUOUS_SYMBOL', 'Specify the listing exchange.');
    }
    const rows = await historyRows(db, { ...query, ...(query.symbol ? { symbol: canonicalSymbol(query.symbol) } : {}) }, now());
    const page = rows.slice(0, query.limit), records = page.map(summary);
    // Report-associated fair values are frozen by the report completion timestamp.
    const reportIds = page.filter(r => r.kind === 'REPORT').map(r => r.id);
    const scenarios = reportIds.length ? await db.entryScenario.findMany({ where: { researchRunId: { in: reportIds } }, orderBy: [{ createdAt: 'desc' }, { version: 'desc' }] }) : [];
    records.forEach((r, i) => { if (r.kind !== 'REPORT') return; const s = scenarios.find(s => s.researchRunId === r.id && s.createdAt <= page[i]!.date && s.dataCutoff <= page[i]!.date);
      if (s) r.fairValue = range(obj(s.resultSnapshot).fairValueRange ?? obj(s.resultSnapshot).watchlistProjection, s.currency); });
    return { records, nextOffset: rows.length > query.limit ? query.offset + query.limit : null, limit: query.limit };
  }
  async function detail(kind: ResearchKind, id: string) {
    const at = now();
    return db.$transaction(async tx => {
      const run = kind === 'REPORT' ? await tx.researchRun.findUnique({ where: { id }, include: { instrument: true, sources: true, notes: { orderBy: { createdAt: 'asc' } } } }) : null;
      const scenario = kind === 'SCENARIO' ? await tx.entryScenario.findUnique({ where: { id }, include: { instrument: true, researchRun: { select: { status: true, completedAt: true } } } }) : null;
      const note = kind === 'NOTE' ? await tx.researchNote.findUnique({ where: { id }, include: { instrument: true } }) : null;
      const row = run ?? scenario ?? note;
      if (!row || row.createdAt > at || run && (run.status !== 'SUCCEEDED' || !run.completedAt || run.completedAt > at || run.dataCutoff > at) || scenario && scenario.dataCutoff > at) throw new HttpError(404, 'NOT_FOUND', 'Saved research record not found.');
      if (scenario?.researchRunId && (scenario.researchRun?.status !== 'SUCCEEDED' || !scenario.researchRun.completedAt || scenario.researchRun.completedAt > at)) throw new HttpError(404, 'NOT_FOUND', 'Completed research record not found.');
      const associated = run ? await tx.entryScenario.findFirst({ where: { researchRunId: run.id, createdAt: { lte: run.completedAt! }, dataCutoff: { lte: run.completedAt! } }, orderBy: [{ createdAt: 'desc' }, { version: 'desc' }] }) : null;
      const s = scenario ?? associated, n = note ? noteData(note.content) : {};
      const input = run?.inputSnapshot ?? s?.inputSnapshot ?? n.inputSnapshot ?? {}, output = run?.output ?? s?.resultSnapshot ?? n;
      const result = obj(s?.resultSnapshot), base = Array.isArray(result.cases) ? result.cases.map(obj).find(c => c.name === 'base') : undefined;
      const projection = obj(result.watchlistProjection), qualitative = obj(obj(output).overviewProjection);
      const sources = (run?.sources ?? []).flatMap(source => { const url = researchUrl(source.url); return url ? [{ title: source.title, url, citationKey: source.citationKey, publishedAt: source.publishedAt?.toISOString() ?? null }] : []; });
      const facts = obj(input).facts;
      if (Array.isArray(facts)) facts.forEach(f => { const fact = obj(f), url = researchUrl(fact.sourceUrl); if (url && !sources.some(s => s.url === url)) sources.push({ title: str(fact.concept) ?? 'Saved SEC source', url, citationKey: str(fact.accessionNumber) ?? '', publishedAt: str(fact.availableAt) }); });
      const date = run?.completedAt ?? row.createdAt;
      const record = summary({ id, kind, instrumentId: row.instrumentId, symbol: row.instrument.symbol, exchange: row.instrument.exchange, company: row.instrument.name, currency: row.instrument.currency,
        seriesId: row.seriesId, version: row.version, date, cutoff: run?.dataCutoff ?? s?.dataCutoff ?? date, summary: run ? str(obj(run.output).summary) : note?.content ?? s?.method ?? null, result: s?.resultSnapshot ?? null });
      record.fairValue = s ? range(result.fairValueRange ?? projection, s.currency) : null;
      const siblingWhere = { instrumentId: row.instrumentId, seriesId: row.seriesId, createdAt: { lte: at } };
      const siblings = kind === 'REPORT' ? await tx.researchRun.findMany({ where: { ...siblingWhere, status: 'SUCCEEDED', completedAt: { lte: at }, dataCutoff: { lte: at } }, orderBy: { version: 'desc' }, take: 100 }) : kind === 'SCENARIO' ? await tx.entryScenario.findMany({ where: { ...siblingWhere, dataCutoff: { lte: at } }, orderBy: { version: 'desc' }, take: 100 }) : await tx.researchNote.findMany({ where: siblingWhere, orderBy: { version: 'desc' }, take: 100 });
      return { record, price: savedPrice(input, row.instrument.currency), assumptions: s?.assumptions ?? obj(input).assumptions ?? null,
        entryZone: s?.lowerPrice && s.upperPrice ? { lower: s.lowerPrice.toFixed(), upper: s.upperPrice.toFixed(), currency: s.currency } : null,
        marginOfSafety: decimal(base?.currentPriceMarginOfSafetyPercent ?? obj(output).marginOfSafetyPercent), plannedMarginOfSafety: base?.plannedEntryMarginOfSafetyPercent ?? null,
        analysis: run?.output ?? (note ? str(n.content) : s?.resultSnapshot) ?? null, thesis: note ? str(n.content) : str(obj(output).thesis) ?? str(obj(output).summary),
        risks: points(qualitative.bearishRisks ?? obj(output).risks ?? n.risks), catalysts: points(qualitative.catalysts ?? obj(output).catalysts ?? n.catalysts), bullishDrivers: points(qualitative.bullishDrivers ?? obj(output).bullishDrivers),
        sources, notes: (run?.notes ?? []).filter(n => n.createdAt <= at).map(n => ({ id: n.id, version: n.version, createdAt: n.createdAt.toISOString(), content: str(noteData(n.content).content) ?? n.content, addedAfterReport: n.createdAt > date })),
        versions: siblings.map(r => ({ id: r.id, version: r.version, createdAt: r.createdAt.toISOString() })),
        snapshot: { inputs: input, outputs: output, formulaVersion: s?.methodVersion ?? null },
      };
    }, { isolationLevel: 'RepeatableRead' });
  }
  async function saveNote(symbol: string, input: z.infer<typeof noteInputSchema>) {
    return db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(70011206)`;
      const instrument = await valuationInstrument(tx, canonicalSymbol(symbol), input.exchange), at = now();
      const previous = input.seriesId ? await tx.researchNote.findFirst({ where: { instrumentId: instrument.id, seriesId: input.seriesId }, orderBy: { version: 'desc' } }) : null;
      if (input.seriesId && (!previous || previous.version !== input.expectedVersion)) throw new HttpError(409, 'RESEARCH_CONFLICT', 'Note version changed. Reload before revising.');
      const researchRunId = previous?.researchRunId ?? input.researchRunId;
      if (previous && input.researchRunId && input.researchRunId !== previous.researchRunId) throw new HttpError(409, 'RESEARCH_CONFLICT', 'A revision must retain its report association.');
      if (researchRunId && !await tx.researchRun.findFirst({ where: { id: researchRunId, instrumentId: instrument.id, status: 'SUCCEEDED', completedAt: { lte: at } } })) throw new HttpError(404, 'NOT_FOUND', 'Completed report not found for this stock.');
      const price = await tx.priceBar.findFirst({ where: { instrumentId: instrument.id, currency: instrument.currency, exchangeTimezone: instrument.exchangeTimezone, provider: 'TIINGO', interval: 'DAY', adjustmentMode: 'RAW', retrievedAt: { lte: at }, tradingDate: { lte: new Date(at.getTime() - 29 * 3600000) } }, orderBy: { tradingDate: 'desc' } });
      const content = JSON.stringify({ schemaVersion: 'research-note-v1', title: input.title, content: input.content, risks: input.risks, catalysts: input.catalysts,
        inputSnapshot: { cutoff: at.toISOString(), price: price ? { id: price.id, close: price.close.toFixed(), currency: price.currency, tradingDate: price.tradingDate.toISOString().slice(0, 10), retrievedAt: price.retrievedAt.toISOString(), revision: price.revision, sourceHash: price.sourceHash, provider: price.provider, adjustmentMode: price.adjustmentMode } : null } });
      const row = await tx.researchNote.create({ data: { instrumentId: instrument.id, ...(researchRunId ? { researchRunId } : {}), seriesId: previous?.seriesId ?? randomUUID(), version: (previous?.version ?? 0) + 1, content, createdAt: at } });
      return { id: row.id, kind: 'NOTE' as const, version: row.version };
    });
  }
  return { list, detail, saveNote };
}
export type ResearchHistoryService = ReturnType<typeof createResearchHistoryService>;
