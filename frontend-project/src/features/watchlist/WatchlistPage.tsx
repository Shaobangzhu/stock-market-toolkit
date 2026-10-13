import { lazy, Suspense, useState } from 'react';
import { Alert, Button, Input, Modal, Popconfirm, Select, Space, Switch, Table, Tag, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DeleteOutlined, EditOutlined, FileSearchOutlined, LineChartOutlined, PlusOutlined, ReloadOutlined, SafetyOutlined, AimOutlined, UnorderedListOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { EmptyState, ErrorState, LoadingState } from '../../components/States';
import { MetricCard } from '../../components/MetricCard';
import { ApiError } from '../../api/client';
import { DEFAULT_WATCHLIST_FILTERS, STATUS_LABELS, removeWatchlist, requestError, syncWatchlistStock, updateWatchlist, watchlistQuery, type AddResponse, type ResearchStatus, type WatchlistFilters, type WatchlistItem } from '../../api/watchlist';
import { formatFinancialValue } from '../../utils/format';
import { AddStockModal, initialHistoryDate } from './AddStockModal';
const Sparkline = lazy(() => import('./Sparkline').then(module => ({ default: module.Sparkline })));

const statusOptions = Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }));
const price = (value: string | null | undefined, currency = 'USD') => value == null ? 'N/A' : formatFinancialValue(value, currency);
const percent = (value: string | null | undefined) => value == null ? 'N/A' : `${Number(value) > 0 ? '+' : ''}${Number(value).toFixed(2)}%`;
const date = (value: string | null | undefined) => value ? new Date(value).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }) : 'N/A';
function RangeValue({ range }: { range: WatchlistItem['entryZone'] | WatchlistItem['fairValue'] }) {
  return range ? <span title={`Saved ${date(range.savedAt)} · ${range.currency}`}>{price(range.lower, range.currency)} – {price(range.upper, range.currency)}</span> : <span className="financial-unavailable">N/A</span>;
}

function AnnotationsModal({ entry, onClose, onSave, pending, error }: { entry: WatchlistItem; onClose: () => void; onSave: (changes: { tags: string[]; notes: string }) => void; pending: boolean; error: unknown }) {
  const [tags, setTags] = useState(entry.tags), [notes, setNotes] = useState(entry.notes);
  return <Modal open title={`${entry.symbol} · Tags & Notes`} onCancel={onClose} footer={<Space><Button disabled={pending} onClick={onClose}>Cancel</Button><Button type="primary" loading={pending} onClick={() => onSave({ tags, notes })}>Save Annotations</Button></Space>}>
    <p className="modal-intro">Personal notes remain local and are retained when you remove Watchlist membership.</p>
    {!!error && <Alert type="error" showIcon title={requestError(error)} />}
    <label className="annotation-field">Custom tags<Select aria-label="Custom tags" mode="tags" value={tags} maxCount={10} tokenSeparators={[',']} onChange={setTags} placeholder="Add up to 10 tags" /></label>
    <label className="annotation-field">Personal notes<Input.TextArea aria-label="Personal notes" rows={7} maxLength={8000} showCount value={notes} onChange={event => setNotes(event.target.value)} /></label>
  </Modal>;
}

export function WatchlistPage() {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<WatchlistFilters>(DEFAULT_WATCHLIST_FILTERS);
  const [selectedId, setSelectedId] = useState<string | null>(null), [adding, setAdding] = useState(false), [editing, setEditing] = useState<WatchlistItem | null>(null);
  const [notice, setNotice] = useState<{ type: 'success' | 'warning'; text: string } | null>(null);
  const query = useQuery(watchlistQuery(filters));
  const reload = () => queryClient.invalidateQueries({ queryKey: ['watchlist'] });
  const patch = useMutation({ mutationFn: ({ row, changes }: { row: WatchlistItem; changes: { researchStatus?: ResearchStatus; tags?: string[]; notes?: string } }) => updateWatchlist(row, changes),
    onSuccess: async () => { setEditing(null); await reload(); }, onError: async error => { if (error instanceof ApiError && error.code === 'WATCHLIST_CONFLICT') { setEditing(null); await reload(); } } });
  const remove = useMutation({ mutationFn: removeWatchlist, onSuccess: async () => { setSelectedId(null); await reload(); } });
  const sync = useMutation({ mutationFn: (row: WatchlistItem) => syncWatchlistStock(row, initialHistoryDate()), onSuccess: async () => { setNotice({ type: 'success', text: 'Historical synchronization queued. Progress appears on the selected stock.' }); await reload(); } });
  const error = patch.error ?? remove.error ?? sync.error;
  const items = query.data?.items ?? [], selected = items.find(row => row.id === selectedId) ?? items[0];
  function change<K extends keyof WatchlistFilters>(key: K, value: WatchlistFilters[K]) { setFilters(current => ({ ...current, [key]: value })); }
  function onAdded(response: AddResponse) {
    setAdding(false); setSelectedId(response.id); setFilters({ ...DEFAULT_WATCHLIST_FILTERS, includeArchived: true });
    setNotice({ type: response.syncError ? 'warning' : 'success', text: response.syncError ? `${response.symbol} added. ${requestError(new ApiError(503, response.syncError.code))}`
      : response.syncJob ? `${response.symbol} added. Historical synchronization queued.` : `${response.symbol} added. No history was imported.` });
    void reload();
  }
  const columns: ColumnsType<WatchlistItem> = [
    { title: 'Symbol', key: 'symbol', fixed: 'left', width: 100, render: (_, row) => <Button type="text" className="watchlist-symbol" aria-label={`Select ${row.symbol}`} onClick={() => setSelectedId(row.id)}>{row.symbol}</Button> },
    { title: 'Company', key: 'company', width: 190, render: (_, row) => <div className="watchlist-company"><strong>{row.company}</strong><small>{row.exchange}</small>{row.tags.length > 0 && <div>{row.tags.map(tag => <Tag key={tag}>{tag}</Tag>)}</div>}</div> },
    { title: 'Last Price', key: 'price', width: 115, align: 'right', render: (_, row) => <div className="financial-cell">{price(row.lastPrice?.value, row.currency)}{row.lastPrice && <small title={`${row.lastPrice.provider} · ${row.lastPrice.adjustmentMode}`}>{row.lastPrice.tradingDate}</small>}</div> },
    { title: 'Daily Change', key: 'dailyChange', width: 112, align: 'right', render: (_, row) => <span className={row.dailyChange ? Number(row.dailyChange.percent) > 0 ? 'market-up' : Number(row.dailyChange.percent) < 0 ? 'market-down' : '' : 'financial-unavailable'}>{percent(row.dailyChange?.percent)}</span> },
    { title: '52W Range', key: 'range', width: 165, render: (_, row) => row.range52Week ? <div className="financial-cell"><span>{price(row.range52Week.low, row.currency)} – {price(row.range52Week.high, row.currency)}</span><small>{row.range52Week.coverage === 'partial' ? 'Partial stored range' : 'Stored RAW range'} · through {row.range52Week.through}</small></div> : 'N/A' },
    { title: 'Fair Value', key: 'fairValue', width: 145, render: (_, row) => <RangeValue range={row.fairValue} /> },
    { title: 'Target Entry Zone', key: 'entry', width: 150, render: (_, row) => <RangeValue range={row.entryZone} /> },
    { title: 'Distance to Entry', key: 'distance', width: 126, align: 'right', render: (_, row) => <Tooltip title="Distance to nearest saved zone boundary at stored close; zero means inside the zone. Negative is below, positive above."><span>{percent(row.distanceToEntry)}</span></Tooltip> },
    { title: 'Research Status', key: 'status', width: 164, render: (_, row) => <div onClick={event => event.stopPropagation()}><Select aria-label={`Research status for ${row.symbol}`} size="small" value={row.researchStatus} options={statusOptions} disabled={patch.isPending} onChange={value => patch.mutate({ row, changes: { researchStatus: value } })} /></div> },
    { title: 'Last Research', key: 'research', width: 125, render: (_, row) => row.latestResearch ? date(row.latestResearch.completedAt) : <span className="financial-unavailable">Not Researched</span> },
    { title: 'Last Updated', key: 'updated', width: 115, render: (_, row) => <span title={row.lastUpdatedAt}>{date(row.lastUpdatedAt)}</span> },
    { title: 'Manage', key: 'actions', width: 86, render: (_, row) => <Space size={0} onClick={event => event.stopPropagation()}><Button type="text" aria-label={`Edit ${row.symbol} notes and tags`} icon={<EditOutlined />} onClick={() => { patch.reset(); setEditing(row); }} /><Popconfirm title={`Remove ${row.symbol}?`} description="Saved prices, research, tags and notes are retained." onConfirm={() => remove.mutateAsync(row.id)} okText="Remove" cancelText="Keep"><Button type="text" aria-label={`Remove ${row.symbol}`} icon={<DeleteOutlined />} disabled={remove.isPending} /></Popconfirm></Space> },
  ];
  const summary = query.data?.summary;
  return <div className="page watchlist-page">
    <section className="page-heading"><div><span className="eyebrow">YOUR RESEARCH WORKSPACE</span><h1>Watchlist</h1><p>Track researched stocks, monitor saved entry zones, and open a deep-dive workspace.</p></div>
      <Space><Button aria-label="Refresh Watchlist" icon={<ReloadOutlined />} loading={query.isFetching} onClick={() => void query.refetch()}>Refresh Watchlist</Button><Button aria-label="Add Stock" type="primary" icon={<PlusOutlined />} onClick={() => setAdding(true)}>Add Stock</Button></Space>
    </section>
    <section className="metric-grid watchlist-metrics" aria-label="Watchlist summary">
      <MetricCard label="TRACKED STOCKS" value={summary ? String(summary.tracked) : '—'} detail={summary ? `${summary.archived} archived · saved locally` : 'Loading your workspace'} icon={<UnorderedListOutlined />} />
      <MetricCard label="NEAR ENTRY ZONE" value={summary ? String(summary.nearEntry) : '—'} detail={`Within ${filters.nearPercent}% · comparable fresh cache only`} icon={<AimOutlined />} />
      <MetricCard label="SAVED RESEARCH" value={summary ? String(summary.researched) : '—'} detail="Stocks with completed research reports" icon={<FileSearchOutlined />} />
      <MetricCard label="PRICE COVERAGE" value={summary ? `${summary.priced} / ${query.data!.total}` : '—'} detail={summary ? `${summary.fresh} with recent successful cache` : 'Checking stored prices'} icon={<SafetyOutlined />} />
    </section>
    {notice && <Alert type={notice.type} showIcon title={notice.text} closable onClose={() => setNotice(null)} />}
    {error && !editing && <Alert type="error" showIcon title={requestError(error)} />}
    {query.isError && query.data && <Alert type="warning" showIcon title="Could not refresh the Watchlist. Showing the last successful cached response." description={requestError(query.error)} />}
    {query.isError && !query.data ? <><ErrorState title="Watchlist unavailable" description={requestError(query.error)} /><Button onClick={() => void query.refetch()}>Retry Watchlist</Button></> : query.isPending ? <LoadingState label="Loading Watchlist" /> : query.data!.total === 0 ? <section className="panel watchlist-empty-panel">
      <EmptyState icon={<span className="empty-state__graphic" aria-hidden="true"><LineChartOutlined /></span>} title="Your Watchlist Is Empty" description="Add your first stock to begin researching price history, fundamentals, and entry opportunities."
        action={<Button aria-label="Add Stock" type="primary" icon={<PlusOutlined />} onClick={() => setAdding(true)}>Add Stock</Button>} />
      <div className="empty-watchlist-guidance"><span>01 · Choose a company</span><span>02 · Import the data you need</span><span>03 · Build your research</span></div>
    </section> : <div className="watchlist-workspace">
      <section className="panel watchlist-table-panel" aria-labelledby="watchlist-title">
        <div className="panel__header"><h2 id="watchlist-title">Watchlist</h2><span className="panel__minor">{query.data.filteredCount} of {query.data.total} entries</span></div>
        <div className="watchlist-filters">
          <Input aria-label="Filter Watchlist" placeholder="Filter symbol, company or tag…" value={filters.search} onChange={event => change('search', event.target.value)} allowClear />
          <Select aria-label="Filter research status" value={filters.status} options={[{ value: '', label: filters.includeArchived ? 'All statuses' : 'All active statuses' }, ...statusOptions]} onChange={value => change('status', value)} />
          <Select aria-label="Filter custom tag" value={filters.tag} options={[{ value: '', label: 'All tags' }, ...query.data.availableTags.map(tag => ({ value: tag, label: tag }))]} onChange={value => change('tag', value)} />
          <Select aria-label="Sort Watchlist" value={`${filters.sort}:${filters.direction}`} options={[{ value: 'symbol:asc', label: 'Symbol A–Z' }, { value: 'company:asc', label: 'Company A–Z' }, { value: 'distance:asc', label: 'Nearest saved entry' }, { value: 'distance:desc', label: 'Farthest from entry' }, { value: 'price:desc', label: 'Last price: high first' }, { value: 'lastResearch:desc', label: 'Latest research' }, { value: 'lastUpdated:desc', label: 'Recently updated' }]} onChange={value => { const [sort, direction] = value.split(':'); setFilters(current => ({ ...current, sort: sort!, direction: direction! })); }} />
        </div>
        <div className="watchlist-filter-toggles"><label><Switch size="small" checked={filters.nearEntry} onChange={value => change('nearEntry', value)} /> Near entry zone ≤ <Select size="small" aria-label="Near entry threshold" value={filters.nearPercent} options={[0, 2, 5, 10].map(value => ({ value, label: `${value}%` }))} onChange={value => change('nearPercent', value)} /></label><label><Switch size="small" checked={filters.includeArchived} onChange={value => change('includeArchived', value)} /> Include archived</label></div>
        <Table<WatchlistItem> rowKey="id" columns={columns} dataSource={items} size="small" scroll={{ x: 1650 }} pagination={{ pageSize: 20, hideOnSinglePage: true }}
          rowClassName={row => row.id === selected?.id ? 'watchlist-row--selected' : ''} onRow={row => ({ onClick: () => setSelectedId(row.id) })}
          locale={{ emptyText: <EmptyState title="No matching stocks" description="Adjust your filters to see your saved Watchlist." action={<Button onClick={() => setFilters({ ...DEFAULT_WATCHLIST_FILTERS, includeArchived: true })}>Clear Filters</Button>} /> }} />
        <p className="watchlist-data-caption">Tiingo daily EOD · stored RAW prices · no live quotes. N/A means missing or incomparable inputs. Green/red indicate daily price changes only.</p>
      </section>
      <aside className="panel selected-stock-panel" aria-label="Selected stock">
        {!selected ? <EmptyState title="Select a stock" description="Choose a matching row to open its research preview." /> : <>
          <div className="selected-stock-heading"><div className="selected-stock-symbol-mark">{selected.symbol.slice(0, 2)}</div><div><h2>{selected.symbol}</h2><p>{selected.company}</p><small>{selected.exchange} · {selected.currency}</small></div></div>
          <Tag className={`research-status research-status--${selected.researchStatus.toLowerCase()}`}>{STATUS_LABELS[selected.researchStatus]}</Tag>
          <div className="selected-stock-price"><strong>{price(selected.lastPrice?.value, selected.currency)}</strong><span className={selected.dailyChange && Number(selected.dailyChange.percent) < 0 ? 'market-down' : selected.dailyChange && Number(selected.dailyChange.percent) > 0 ? 'market-up' : ''}>{selected.dailyChange ? `${price(selected.dailyChange.value, selected.currency)} (${percent(selected.dailyChange.percent)})` : 'Daily change N/A'}</span><small>{selected.lastPrice ? `Stored EOD ${selected.lastPrice.tradingDate} · ${selected.freshness}` : 'No price history imported'}</small></div>
          <Suspense fallback={<div className="sparkline-empty">Loading price chart…</div>}><Sparkline points={selected.sparkline} /></Suspense>
          <div className="selected-stock-ranges"><div><small>Saved Fair Value</small><strong><RangeValue range={selected.fairValue} /></strong></div><div><small>Target Entry Zone</small><strong><RangeValue range={selected.entryZone} /></strong></div></div>
          <div className="entry-distance-card"><AimOutlined /><div><small>Distance to saved entry</small><strong>{percent(selected.distanceToEntry)}</strong><span>{selected.distanceToEntry === null ? 'Comparable saved scenario required' : Number(selected.distanceToEntry) === 0 ? 'Inside saved zone at stored close' : Number(selected.distanceToEntry) < 0 ? 'Below saved zone at stored close' : 'Above saved zone at stored close'}</span></div></div>
          <section className="selected-stock-thesis"><h3>Latest Research</h3><p>{selected.latestResearch ? selected.latestResearch.summary ?? 'This saved report has no summary.' : 'Not Researched'}</p>{selected.latestResearch && <small>Version {selected.latestResearch.version} · {date(selected.latestResearch.completedAt)}</small>}</section>
          <div className="selected-stock-notes"><h3>Personal Notes</h3><p>{selected.notes || 'No personal notes yet.'}</p><Button aria-label="Edit Tags & Notes" size="small" icon={<EditOutlined />} onClick={() => { patch.reset(); setEditing(selected); }}>Edit Tags & Notes</Button></div>
          <div className="selected-stock-actions"><Link aria-label="Open Research" to={`/stocks/${encodeURIComponent(selected.symbol)}`}><Button block type="primary" icon={<FileSearchOutlined />}>Open Research</Button></Link><Link aria-label="Open Chart" to={`/stocks/${encodeURIComponent(selected.symbol)}?tab=price-volume`}><Button block icon={<LineChartOutlined />}>Open Chart</Button></Link>
            <Button block icon={<ReloadOutlined />} loading={sync.isPending || ['QUEUED', 'RUNNING'].includes(selected.lastSyncJob?.status ?? '')} onClick={() => sync.mutate(selected)}>{selected.lastPrice ? 'Sync Prices' : 'Import 1Y History'}</Button>
          </div>
          {selected.lastSyncJob && <div className="watchlist-job-status" role="status">Price sync: {selected.lastSyncJob.status.toLowerCase()}{selected.lastSyncJob.errorCode && <p>{requestError(new ApiError(502, selected.lastSyncJob.errorCode))}</p>}{selected.lastSyncJob.retryAfter && <small>Retry after {selected.lastSyncJob.retryAfter}</small>}</div>}
        </>}
      </aside>
    </div>}
    {adding && <AddStockModal onClose={() => setAdding(false)} onAdded={onAdded} />}
    {editing && <AnnotationsModal key={editing.id} entry={editing} onClose={() => setEditing(null)} pending={patch.isPending} error={patch.error} onSave={changes => patch.mutate({ row: editing, changes })} />}
  </div>;
}
