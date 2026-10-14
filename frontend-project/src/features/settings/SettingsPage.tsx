import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Checkbox, Form, Input, InputNumber, Modal, Select, Table, Tag } from 'antd';
import { settingsApi, type Preferences, type SyncJob } from '../../api/settings';
import { ApiError } from '../../api/client';
import { MetricCard } from '../../components/MetricCard';
import { LoadingState } from '../../components/States';

const display = (v: unknown) => v === null || v === undefined ? 'N/A' : String(v);
const names: Record<string, string> = { TIINGO: 'Tiingo', SEC_EDGAR: 'SEC EDGAR', OPENAI: 'OpenAI' };
const purposes: Record<string, string> = { TIINGO: 'Historical daily prices', SEC_EDGAR: 'Filings and company fundamentals', OPENAI: 'News and qualitative research' };
export function SettingsPage() {
  const client = useQueryClient();
  const status = useQuery({ queryKey: ['settings-status'], queryFn: settingsApi.status, retry: false });
  const preferences = useQuery({ queryKey: ['settings-preferences'], queryFn: settingsApi.preferences, retry: false });
  const [offset, setOffset] = useState(0), [coverageOffset, setCoverageOffset] = useState(0);
  const jobs = useQuery({ queryKey: ['settings-jobs', offset], queryFn: () => settingsApi.jobs(offset), retry: false, refetchInterval: q => q.state.data?.jobs.some(j => ['RUNNING', 'QUEUED'].includes(j.status)) ? 3000 : false });
  const coverage = useQuery({ queryKey: ['settings-coverage', coverageOffset], queryFn: () => settingsApi.coverage(coverageOffset), retry: false });
  const previousJobs = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!jobs.dataUpdatedAt) return;
    const signature = JSON.stringify(jobs.data?.jobs.map(j => [j.id, j.status]));
    const changed = previousJobs.current !== undefined && signature !== previousJobs.current;
    previousJobs.current = signature;
    if (!changed) return;
    void client.invalidateQueries({ queryKey: ['settings-status'] });
    void client.invalidateQueries({ queryKey: ['settings-coverage'] });
    void client.invalidateQueries({ queryKey: ['watchlist'] });
    void client.invalidateQueries({ queryKey: ['stock'] });
  }, [client, jobs.dataUpdatedAt, jobs.data]);
  const [selected, setSelected] = useState<string>(), [csv, setCsv] = useState(''), [importOpen, setImportOpen] = useState(false), [coverageOpen, setCoverageOpen] = useState(false), [busy, setBusy] = useState(false), [notice, setNotice] = useState<{ type: 'success' | 'error' | 'warning'; text: string }>();
  const [form] = Form.useForm<Preferences>();
  const refresh = async () => { await Promise.all([client.invalidateQueries({ queryKey: ['settings-status'] }), client.invalidateQueries({ queryKey: ['settings-jobs'] }), client.invalidateQueries({ queryKey: ['settings-coverage'] })]); };
  async function action(work: () => Promise<string | { type: 'success' | 'warning'; text: string }>) { setBusy(true); setNotice(undefined); try { const result = await work(); setNotice(typeof result === 'string' ? { type: 'success', text: result } : result); await refresh(); } catch (e) { setNotice({ type: 'error', text: e instanceof ApiError ? e.publicMessage ?? e.code : 'The local data operation failed. Check the backend connection.' }); } finally { setBusy(false); } }
  const data = status.data;
  return <div className="page settings-page">
    <section className="page-heading"><div><span className="eyebrow">LOCAL CONTROL CENTER</span><h1>Data &amp; Settings</h1><p>Local providers, PostgreSQL, synchronization, and research preferences.</p></div><Button onClick={() => void refresh()} loading={status.isFetching}>Refresh Status</Button></section>
    {notice && <Alert showIcon type={notice.type} title={notice.text} closable onClose={() => setNotice(undefined)} />}
    {status.isPending ? <LoadingState label="Checking local workspace" /> : status.isError ? <Alert type="error" title="Backend connection unavailable" action={<Button onClick={() => void status.refetch()}>Retry</Button>} /> : null}
    <div className="metrics-grid">
      <MetricCard label="Providers Available" value={data ? `${data.availableProviders} / ${data.providers.length}` : 'N/A'} detail="Verified by successful synchronization; historical evidence" />
      <MetricCard label="Database Health" value={data?.database.status ?? 'Unknown'} />
      <MetricCard label="Pending Sync Jobs" value={display(data?.pendingJobs)} detail="Queued and running persisted jobs" />
      <MetricCard label="AI Configuration Status" value={data ? data.aiConfigured ? 'Configured' : 'Not Configured' : 'Unknown'} detail="Configuration presence does not prove connectivity" />
    </div>
    <section className="panel"><div className="panel__header"><h2>Provider Status</h2><small>Checked {data?.checkedAt ? new Date(data.checkedAt).toLocaleString() : 'N/A'}</small></div>
      <Table rowKey="id" pagination={false} scroll={{ x: 900 }} dataSource={data?.providers ?? []} columns={[
        { title: 'Provider', dataIndex: 'id', render: id => names[id] ?? id }, { title: 'Purpose', dataIndex: 'id', render: id => purposes[id] },
        { title: 'Status', dataIndex: 'status', render: value => <Tag color={value === 'Online' ? 'green' : value === 'Error' ? 'red' : 'default'}>{value}</Tag> },
        { title: 'Last Success', dataIndex: 'lastSuccess', render: display }, { title: 'Quota / Usage', dataIndex: 'quota', render: q => q ? `${q.requestsLastHour} / ${q.localHourlyBudget} requests · local hourly budget` : 'Unknown / Not Available' }, { title: 'Last Error', dataIndex: 'lastError', render: display },
      ]} locale={{ emptyText: 'Provider status unavailable' }} />
      <p className="muted">Online reflects a saved successful sync, not a live probe. Tiingo counters cover this application only. SEC and OpenAI quota usage is unavailable. Credentials are configured in backend .env.</p>
    </section>
    <div className="settings-grid">
      <section className="panel"><h2>Local PostgreSQL</h2>{data?.database.status === 'Unavailable' && <Alert type="warning" title="Database unavailable" description="Start local PostgreSQL and apply migrations." />}
        {Object.entries({ Connection: data?.database.status, Database: data?.database.name, Engine: data?.database.version ? `PostgreSQL ${data.database.version}` : null, Instruments: data?.database.instruments, 'Historical price records': data?.database.priceRecords, 'Research reports': data?.database.researchReports, 'Earliest price date': data?.database.earliestPriceDate, 'Latest price date': data?.database.latestPriceDate, 'Last synchronization': data?.database.lastSync }).map(([label, value]) => <div className="settings-list" key={label}><span>{label}</span><strong>{display(value)}</strong></div>)}
      </section>
      <section className="panel"><h2>Data Management</h2><div className="settings-actions">
        <Button type="primary" disabled={busy} onClick={() => void action(async () => { const result = await settingsApi.syncWatchlist(); const failed = result.results.filter(r => r.errorCode); return { type: failed.length ? 'warning' as const : 'success' as const, text: `${result.results.length - failed.length} price jobs accepted. ${failed.length} failed${failed.length ? ': ' + failed.map(r => `${r.symbol}: ${r.errorCode}`).join(', ') : ''}.` }; })}>Sync Watchlist Prices</Button>
        <Select aria-label="Stock to synchronize" placeholder="Select an existing stock" value={selected} onChange={setSelected} options={coverage.data?.instruments.map(s => ({ label: `${s.symbol} · ${s.exchange}`, value: s.id }))} />
        <Button disabled={busy || !selected} onClick={() => void action(async () => { const stock = coverage.data?.instruments.find(s => s.id === selected); if (!stock) throw new Error(); const j = await settingsApi.syncStock(stock); return `Historical synchronization accepted: ${j.id}`; })}>Sync Selected Stock History</Button>
        <Button disabled={busy} onClick={() => setImportOpen(true)}>Import Supported CSV</Button>
        <Button disabled={busy} onClick={() => void action(async () => { const value = await settingsApi.exportResearch(); const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = `srl-research-${new Date().toISOString().slice(0, 10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); return 'Research export downloaded with original snapshots and metadata.'; })}>Export Research Data</Button>
        <Button onClick={() => setCoverageOpen(true)}>Inspect Data Coverage</Button>
        <Button onClick={() => document.getElementById('recent-sync-jobs')?.scrollIntoView({ behavior: 'smooth' })}>View Recent Sync Jobs</Button>
      </div><p className="muted">Sync imports data only on your request. Empty Watchlists create no jobs. CSV supports manual notes for existing instruments, without altering prices.</p>
      {coverage.isError && <Alert type="warning" title="Stock selection unavailable" />}
      {coverage.data && <div><Button disabled={!coverageOffset} onClick={() => { setCoverageOffset(Math.max(0, coverageOffset - 50)); setSelected(undefined); }}>Previous stocks</Button><Button disabled={coverage.data.nextOffset === null} onClick={() => { setCoverageOffset(coverage.data!.nextOffset!); setSelected(undefined); }}>More stocks</Button></div>}
      </section>
      <section className="panel"><h2>OpenAI Preferences</h2>{preferences.isError ? <Alert type="warning" title="Preferences unavailable" /> : preferences.isPending ? <LoadingState label="Loading preferences" /> : <Form key={JSON.stringify(preferences.data)} form={form} layout="vertical" initialValues={preferences.data} onFinish={v => void action(async () => { await settingsApi.savePreferences({ ...v, monthlyBudgetUsd: v.monthlyBudgetUsd || null }); await client.invalidateQueries({ queryKey: ['settings-preferences'] }); return 'Local research preferences saved.'; })}>
        <Form.Item label="Default research lookback (years)" name="lookbackYears" rules={[{ required: true }]}><InputNumber min={1} max={20} /></Form.Item>
        <Form.Item label="Report detail level" name="detailLevel"><Select options={['concise', 'standard', 'detailed'].map(value => ({ value, label: value }))} /></Form.Item>
        <Form.Item name="includeTechnical" valuePropName="checked"><Checkbox>Include technical analysis</Checkbox></Form.Item><Form.Item name="includeFundamentals" valuePropName="checked"><Checkbox>Include company fundamentals</Checkbox></Form.Item><Form.Item name="includeNews" valuePropName="checked"><Checkbox>Include news</Checkbox></Form.Item>
        <Form.Item label="Optional monthly budget guardrail (USD)" name="monthlyBudgetUsd" rules={[{ pattern: /^(0|[1-9]\d{0,5})(\.\d{1,2})?$/, message: 'Use a nonnegative dollar amount with at most two decimals.' }]}><Input placeholder="No guardrail" /></Form.Item>
        <p className="muted">Saved for future explicit AI research runs. AI execution and spend enforcement are not implemented yet. This preference does not measure account spending.</p><Button htmlType="submit" type="primary" disabled={busy}>Save Preferences</Button>
      </Form>}</section>
      <section className="panel"><h2>Local Environment</h2>{Object.entries({ 'Backend connection': status.isSuccess ? 'Connected' : 'Unavailable', 'Backend address': data?.environment.backend, 'Frontend origin': data?.environment.frontendOrigin, 'Database connectivity': data?.database.status, Mode: data?.environment.mode, 'Configured OpenAI model': data?.environment.model }).map(([k, v]) => <div className="settings-list" key={k}><span>{k}</span><strong>{display(v)}</strong></div>)}<p>Provider configuration: {data?.providers.map(p => `${names[p.id]}: ${p.configured ? 'configured' : 'not configured'}`).join(' · ') ?? 'Unknown'}</p><p className="muted">Secrets stay in backend .env. Research exports contain personal notes; PostgreSQL backups are required for a complete data backup.</p></section>
    </div>
    <section className="panel" id="recent-sync-jobs"><h2>Recent Sync Jobs</h2>{jobs.isError && <Alert type="error" title="Sync jobs unavailable" />}<Table<SyncJob> rowKey="id" pagination={false} scroll={{ x: 900 }} dataSource={jobs.data?.jobs ?? []} locale={{ emptyText: 'No synchronization jobs yet.' }} columns={[{ title: 'Stock', dataIndex: 'symbol' }, { title: 'Provider', dataIndex: 'provider' }, { title: 'Dataset', dataIndex: 'dataset' }, { title: 'Status', dataIndex: 'status' }, { title: 'Created', dataIndex: 'createdAt' }, { title: 'Last Error', dataIndex: 'errorCode', render: display }, { title: 'Retry After', dataIndex: 'retryAfter', render: display }, { title: 'Action', render: (_, j) => ['FAILED', 'INTERRUPTED'].includes(j.status) ? <Button disabled={busy} onClick={() => void action(async () => { await settingsApi.retry(j.id); return 'Retry accepted as a new sync job.'; })}>Retry Failed Sync</Button> : null }]} /><Button disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 50))}>Previous jobs</Button><Button disabled={jobs.data?.nextOffset == null} onClick={() => setOffset(jobs.data!.nextOffset!)}>More jobs</Button></section>
    <Modal title="Import Supported CSV" open={importOpen} onCancel={() => setImportOpen(false)} confirmLoading={busy} onOk={() => void action(async () => { const result = await settingsApi.importCsv(csv); setImportOpen(false); setCsv(''); await client.invalidateQueries({ queryKey: ['research-history'] }); return `${result.imported} manual research notes imported.`; })} okText="Validate & Import"><p>Header: symbol,exchange,title,content. Maximum 100 notes, 30,000 characters. Every symbol and exchange must already exist. Quoted CSV fields are supported. Import is atomic and appends new note series.</p><input aria-label="CSV file" type="file" accept=".csv,text/csv" onChange={e => { const f = e.target.files?.[0]; if (f) { if (f.size > 30000) setNotice({ type: 'error', text: 'CSV exceeds 30,000 bytes.' }); else void f.text().then(setCsv); } }} /><Input.TextArea aria-label="CSV contents" rows={8} value={csv} onChange={e => setCsv(e.target.value)} /></Modal>
    <Modal title="Data Coverage" open={coverageOpen} footer={null} onCancel={() => setCoverageOpen(false)} width={900}><p>Stored observations by provider, basis, currency and timezone. Date bounds do not prove a complete series.</p>{coverage.data?.instruments.length ? coverage.data.instruments.map(s => <div key={s.id}><h3>{s.symbol} · {s.exchange}</h3>{s.series.length ? s.series.map((series, i) => <p key={i}>{series.provider} · {series.interval} · {series.adjustmentMode} · {series.currency} · {series.exchangeTimezone}: {series._count} records · {series._min.tradingDate.slice(0, 10)} — {series._max.tradingDate.slice(0, 10)}</p>) : <p>No historical data stored.</p>}</div>) : <p>No instruments stored.</p>}<Button disabled={!coverageOffset} onClick={() => setCoverageOffset(Math.max(0, coverageOffset - 50))}>Previous</Button><Button disabled={coverage.data?.nextOffset == null} onClick={() => setCoverageOffset(coverage.data!.nextOffset!)}>More</Button></Modal>
  </div>;
}
