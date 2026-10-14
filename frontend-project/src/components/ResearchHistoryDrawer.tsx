import { useEffect, useState } from 'react';
import { Alert, Button, Collapse, Drawer, Input, Modal, Select, Space, Table, Switch } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { EmptyState, LoadingState } from './States';
import { safeResearchUrl, type ResearchRecord } from '../api/stocks';
import { historyDetailQuery, historyListQuery, recordKind, saveResearchNote, type HistoryFilter, type ResearchDetail, type ResearchKind } from '../api/research-history';
import { valuationError } from '../api/valuation';

const show = (v: unknown): string => v == null ? 'N/A' : typeof v === 'string' ? v : JSON.stringify(v, null, 2);
const interval = (v: { lower: string; upper: string; currency: string } | null) => v ? `${v.lower} – ${v.upper} ${v.currency}` : 'N/A';
function OriginalDetails({ detail }: { detail: ResearchDetail }) {
  return <div className="history-details">
    <p>Original data cutoff: {detail.record.dataCutoff}. Saved inputs and conclusions are preserved.</p>
    <dl><dt>Historical price at research</dt><dd>{detail.price ? `${detail.price.value} ${detail.price.currency} · ${detail.price.tradingDate} · ${detail.price.provider ?? 'Provider unavailable'} · ${detail.price.adjustmentMode ?? 'Basis unavailable'}` : 'N/A — no price snapshot was saved.'}</dd>
      <dt>Original fair-value estimate</dt><dd>{interval(detail.record.fairValue)}</dd><dt>Original target entry range</dt><dd>{interval(detail.entryZone)}</dd>
      <dt>Original reference-price margin of safety</dt><dd>{detail.marginOfSafety === null ? 'N/A' : `${detail.marginOfSafety}%`}</dd>
      <dt>Original planned-entry margin of safety</dt><dd><pre>{show(detail.plannedMarginOfSafety)}</pre></dd></dl>
    <h4>Original fair-value assumptions</h4><pre>{show(detail.assumptions)}</pre>
    <h4>Original generated analysis / thesis</h4><pre>{show(detail.analysis)}</pre>
    {([{ title:'Key risks', values:detail.risks },{ title:'Bullish catalysts', values:detail.catalysts },{ title:'Bullish drivers', values:detail.bullishDrivers }]).map(({title,values}) => <section key={title}><h4>{title}</h4>{values.length ? <ul>{values.map((v,i) => <li key={i}>{v}</li>)}</ul> : <p>No saved {title.toLowerCase()}.</p>}</section>)}
    <h4>Source links</h4>{detail.sources.length ? detail.sources.map((s,i) => <p key={i}><a href={safeResearchUrl(s.url)} target="_blank" rel="noopener noreferrer">{s.title}</a>{s.publishedAt && ` · ${s.publishedAt.slice(0,10)}`}</p>) : <p>No source links saved.</p>}
    <h4>Research notes</h4>{detail.notes.length ? detail.notes.map(n => <article key={n.id}><small>v{n.version} · {n.createdAt}{n.addedAfterReport ? ' · Added after this report' : ''}</small><p>{n.content}</p></article>) : <p>No attached research notes.</p>}
    <Collapse items={[{ key:'snapshot', label:'Original immutable snapshot', children:<pre>{show(detail.snapshot)}</pre> }]} />
  </div>;
}
function Comparison({ previous, current }: { previous: ResearchDetail; current: ResearchDetail }) {
  const values = (d: ResearchDetail) => [d.record.completedAt, d.price ? `${d.price.value} ${d.price.currency} · ${d.price.tradingDate}` : null, d.assumptions, interval(d.record.fairValue), interval(d.entryZone), d.risks, d.catalysts, d.bullishDrivers, d.thesis];
  const a = values(previous), b = values(current), labels = ['Research date','Price at research','Valuation assumptions','Fair-value estimates','Entry-price ranges','Key risks','Bullish catalysts','Bullish drivers','Thesis changes'];
  return <Table className="history-comparison" size="small" rowKey="label" pagination={false} scroll={{ x:650 }} dataSource={labels.map((label,i) => ({ label, previous:show(a[i]), current:show(b[i]), changed:show(a[i]) !== show(b[i]) }))} columns={[
    { title:'Field',dataIndex:'label',width:130 }, { title:`Previous · v${previous.record.version}`,dataIndex:'previous',render:v => <pre>{v}</pre> }, { title:`Current · v${current.record.version}`,dataIndex:'current',render:(v,r) => <pre className={r.changed ? 'history-changed' : ''}>{v}</pre> },
  ]} />;
}
export function ResearchHistoryDrawer({ open, onClose, symbol, exchange = '', records = [], selected, onSelect }: {
  open: boolean; onClose: () => void; symbol: string; exchange?: string; records?: ResearchRecord[]; selected?: ResearchRecord | null; onSelect?: (record: ResearchRecord) => void;
}) {
  const client = useQueryClient();
  const [filter, setFilter] = useState<HistoryFilter>({ symbol, exchange, all:false, search:'',kind:'',from:'',to:'',offset:0 });
  const [compareId, setCompareId] = useState<string | null>(null);
  const [noteOpen, setNoteOpen] = useState(false), [revise, setRevise] = useState(false), [title,setTitle] = useState(''), [content,setContent] = useState(''), [risks,setRisks] = useState(''), [catalysts,setCatalysts] = useState('');
  const list = useQuery(historyListQuery({ ...filter, symbol, exchange }, open));
  const detail = useQuery(historyDetailQuery(selected, open));
  const previousRecord = detail.data?.versions.find(v => v.id === compareId);
  const previous = useQuery(historyDetailQuery(previousRecord && selected ? { ...selected, id:previousRecord.id } : null, open && !!compareId));
  useEffect(() => { setCompareId(null); setNoteOpen(false); }, [selected?.id]);
  function update(patch: Partial<HistoryFilter>) { setFilter(f => ({ ...f,...patch,offset:0 })); }
  const note = useMutation({ mutationFn: () => saveResearchNote(revise ? detail.data!.record.symbol ?? symbol : selected?.type === 'AI Report' ? detail.data?.record.symbol ?? symbol : symbol, {
    exchange: revise ? detail.data!.record.exchange ?? exchange : selected?.type === 'AI Report' ? detail.data?.record.exchange ?? exchange : exchange,
    title,content,risks:risks.split('\n').map(v => v.trim()).filter(Boolean),catalysts:catalysts.split('\n').map(v => v.trim()).filter(Boolean),
    ...(revise ? { seriesId:detail.data!.record.seriesId!, expectedVersion:detail.data!.record.version } : selected && recordKind(selected) === 'REPORT' ? { researchRunId:selected.id } : {}),
  }), onSuccess:async () => { setNoteOpen(false); await client.invalidateQueries({ queryKey:['research-history'] }); await client.invalidateQueries({ queryKey:['research-record'] }); await client.invalidateQueries({ queryKey:['stock'] }); } });
  function editNote(revision: boolean) { setRevise(revision); setTitle(revision ? detail.data?.record.summary ?? '' : ''); setContent(revision ? detail.data?.thesis ?? '' : ''); setRisks(revision ? detail.data?.risks.join('\n') ?? '' : ''); setCatalysts(revision ? detail.data?.catalysts.join('\n') ?? '' : ''); note.reset(); setNoteOpen(true); }
  const page = list.data?.records ?? (!filter.all && !filter.search && !filter.kind && !filter.from && !filter.to ? records : []);
  return <Drawer className="research-history-drawer" title={<><span className="eyebrow">{symbol} / RESEARCH</span><strong>Research History</strong></>} placement="right" size={760} open={open} onClose={onClose} destroyOnHidden={false}>
    <div className="history-filters"><Input.Search aria-label="Search research by ticker or keyword" placeholder="Search ticker or keyword…" maxLength={200} onSearch={search => update({search})} allowClear />
      <Select aria-label="Research type" value={filter.kind} onChange={(kind:ResearchKind|'') => update({kind})} options={[{value:'',label:'All research types'},{value:'REPORT',label:'AI Report'},{value:'SCENARIO',label:'Entry Scenario'},{value:'NOTE',label:'Manual Thesis / Note'}]} />
      <label>From (UTC)<Input aria-label="Research from date" type="date" value={filter.from} onChange={e => update({from:e.target.value})} /></label><label>To (UTC)<Input aria-label="Research to date" type="date" value={filter.to} onChange={e => update({to:e.target.value})} /></label>
      <label className="history-all"><Switch aria-label="All Research across tracked stocks" checked={filter.all} onChange={all => update({all})} /> All Research across tracked stocks</label></div>
    <Space wrap><Button onClick={() => editNote(false)} disabled={!exchange || note.isPending || selected?.type === 'AI Report' && !detail.data}>Add {selected?.type === 'AI Report' ? 'Report Note' : 'Thesis / Note'}</Button>{detail.data?.record.kind === 'NOTE' && <Button onClick={() => editNote(true)}>Create Note Revision</Button>}</Space>
    {list.isError && <Alert type="warning" title="Research history unavailable" description={valuationError(list.error)} action={<Button onClick={() => void list.refetch()}>Retry history</Button>} />}
    {page.length === 0 && !selected ? list.isPending ? <LoadingState label="Loading research history" /> : <EmptyState title="No research runs yet" description="Saved AI reports, entry scenarios and manual thesis notes will appear here. Adjust filters or save your first research record." /> : <>
      <div className="history-record-list">{page.map(r => <Button key={`${recordKind(r)}:${r.id}`} type={r.id === selected?.id ? 'primary' : 'default'} onClick={() => onSelect?.(r)}>{r.symbol ?? symbol} · {r.completedAt.slice(0,10)} · {r.type} · v{r.version}</Button>)}</div>
      {!page.length && <p>No records match these filters. Your selected saved record remains open.</p>}
      <Space><Button disabled={filter.offset === 0} onClick={() => setFilter(f => ({...f,offset:Math.max(0,f.offset-50)}))}>Previous records</Button><Button disabled={list.data?.nextOffset == null} onClick={() => setFilter(f => ({...f,offset:list.data!.nextOffset!}))}>Next records</Button></Space>
    </>}
    {selected && <section className="history-selection"><h3>{selected.type} · v{selected.version}</h3><p>{selected.symbol ?? symbol} · Research date: {selected.completedAt.slice(0,10)}</p>
      {detail.isPending ? <LoadingState label="Loading original research record" /> : detail.isError ? <Alert type="error" title="Research record unavailable" description={valuationError(detail.error)} action={<Button onClick={() => void detail.refetch()}>Retry record</Button>} /> : detail.data && <>
        <OriginalDetails detail={detail.data} />
        <h4>Version comparison</h4><p>Compare immutable versions from the same stock, research type and series.</p>
        <Select aria-label="Previous research version" placeholder="Select a previous version" value={compareId} allowClear onChange={id => setCompareId(id ?? null)} options={detail.data.versions.filter(v => v.version < detail.data!.record.version).map(v => ({value:v.id,label:`v${v.version} · ${v.createdAt.slice(0,10)}`}))} />
        {detail.data.versions.filter(v => v.version < detail.data!.record.version).length === 0 && <p>No earlier version in this series.</p>}
        {previous.isError && <Alert type="warning" title="Comparison record unavailable" />}{compareId && previous.isPending && <LoadingState label="Loading previous version" />}{compareId && previous.data && <Comparison previous={previous.data} current={detail.data} />}
      </>}
    </section>}
    <Modal title={revise ? 'Create Note Revision' : 'Save Thesis / Note'} open={noteOpen} onCancel={() => !note.isPending && setNoteOpen(false)} onOk={() => note.mutate()} confirmLoading={note.isPending} okText="Save New Version" okButtonProps={{disabled:!title.trim() || !content.trim()}}>
      <p>Saving appends an immutable version with the current cached EOD snapshot. Earlier versions retain their original text and price.</p>
      <label>Title<Input aria-label="Research note title" maxLength={160} value={title} onChange={e => setTitle(e.target.value)} /></label><label>Thesis / note<Input.TextArea aria-label="Research note content" rows={5} maxLength={12000} value={content} onChange={e => setContent(e.target.value)} /></label>
      <label>Key risks (one per line)<Input.TextArea aria-label="Research note risks" value={risks} onChange={e => setRisks(e.target.value)} /></label><label>Bullish catalysts (one per line)<Input.TextArea aria-label="Research note catalysts" value={catalysts} onChange={e => setCatalysts(e.target.value)} /></label>
      {note.isError && <Alert type="error" title="Note could not be saved" description={valuationError(note.error)} />}
    </Modal>
  </Drawer>;
}
