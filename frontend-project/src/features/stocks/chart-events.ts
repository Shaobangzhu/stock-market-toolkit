import type { Filings, ResearchRecord } from '../../api/stocks';
import { isTradingDate } from '../../api/prices';

export interface ChartEventMarker {
  id: string; kind: 'filing' | 'earnings' | 'major-event' | 'research';
  date: string; occurredAt?: string; label: string; title: string;
  sourceUrl?: string; researchId?: string; provenance: string;
}
export function exchangeDate(timestamp: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(timestamp));
  return `${parts.find(p => p.type === 'year')!.value}-${parts.find(p => p.type === 'month')!.value}-${parts.find(p => p.type === 'day')!.value}`;
}
// US daily close convention: publication at/after 16:00 anchors to the next
// observation. This is a display rule, not an intraday availability claim.
export function observationAnchor(timestamp: string, timezone: string): string {
  const date = exchangeDate(timestamp, timezone);
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: '2-digit', hourCycle: 'h23' }).format(new Date(timestamp)));
  return hour >= 16 ? new Date(Date.parse(date + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10) : date;
}
// Never infer earnings from 8-K, fiscal period ends, estimates or headlines.
export function chartEvents(filings: Filings['filings'], records: ResearchRecord[], timezone: string, verified: readonly ChartEventMarker[] = []): ChartEventMarker[] {
  const events: ChartEventMarker[] = [
    ...filings.filter(f => isTradingDate(f.filedDate.slice(0, 10))).map(f => ({ id: f.id, kind: 'filing' as const, date: f.filedDate.slice(0, 10), label: f.form, title: `${f.form} filing`, sourceUrl: f.sourceUrl, provenance: 'SEC publication date; exact release time unavailable' })),
    ...records.map(r => ({ id: r.id, kind: 'research' as const, date: exchangeDate(r.completedAt, timezone), occurredAt: r.completedAt, label: `R${r.version}`, title: `${r.type} · version ${r.version}`, researchId: r.id, provenance: `Saved report completion · ${timezone}` })),
    ...verified.filter(e => ['earnings', 'major-event'].includes(e.kind) && isTradingDate(e.date) && !!e.sourceUrl && !!e.provenance),
  ];
  return [...new Map(events.map(e => [e.id, e])).values()].sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
}
