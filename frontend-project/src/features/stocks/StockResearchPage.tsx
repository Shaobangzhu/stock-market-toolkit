import { useEffect, useState } from 'react';
import { Alert, Button, Checkbox, Modal, Space, Tabs } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useSearchParams } from 'react-router-dom';
import { StockHeader } from '../../components/StockHeader';
import { ErrorState, LoadingState } from '../../components/States';
import { ResearchHistoryDrawer } from '../../components/ResearchHistoryDrawer';
import { ApiError } from '../../api/client';
import { normalizeStockSymbol, overviewQuery, researchQuery, syncFundamentals, syncJobQuery, syncStock, type PriceRange, type ResearchRecord } from '../../api/stocks';
import { requestError } from '../../api/watchlist';
import { OverviewSections } from './OverviewSections';
import { PriceVolumeWorkspace } from './PriceVolumeWorkspace';

function StockWorkspace({ symbol }: { symbol: string }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [range, setRange] = useState<PriceRange>('1Y');
  const [selected, setSelected] = useState<ResearchRecord | null>(null);
  const [syncOpen, setSyncOpen] = useState(false), [fullHistory, setFullHistory] = useState(false), [includeSec, setIncludeSec] = useState(false);
  const [priceJobId, setPriceJobId] = useState<string | null>(null), [secJobId, setSecJobId] = useState<string | null>(null);
  const client = useQueryClient();
  const overview = useQuery(overviewQuery(symbol, '1Y'));
  const activeTab = searchParams.get('tab') === 'price-volume' ? 'price-volume' : 'overview';
  const historyOpen = searchParams.get('history') === 'open';
  const history = useQuery(researchQuery(symbol, historyOpen && !!overview.data));
  const priceJob = useQuery(syncJobQuery(priceJobId)), secJob = useQuery(syncJobQuery(secJobId));
  useEffect(() => {
    if ([priceJob.data, secJob.data].some(job => job && !['QUEUED', 'RUNNING'].includes(job.status))) {
      void client.invalidateQueries({ queryKey: ['stock', symbol] }); void client.invalidateQueries({ queryKey: ['watchlist'] });
    }
  }, [priceJob.data, secJob.data, symbol, client]);
  const sync = useMutation({ mutationFn: async () => {
    if (!overview.data) throw Error('Stock unavailable');
    const errors: string[] = [];
    try { const job = await syncStock(overview.data.stock, fullHistory || !overview.data.stock.lastPrice); setPriceJobId(job.id); } catch (error) { errors.push(requestError(error)); }
    if (includeSec) { try { const job = await syncFundamentals(overview.data.stock); setSecJobId(job.id); } catch (error) { errors.push(requestError(error)); } }
    await client.invalidateQueries({ queryKey: ['stock', symbol] });
    if (errors.length) throw Error(errors.join(' '));
    setSyncOpen(false);
  } });
  function updateParams(tab: 'overview' | 'price-volume', openHistory = false) { setSearchParams(previous => { const next = new URLSearchParams(previous); if (tab === 'overview') next.delete('tab'); else next.set('tab', tab); if (openHistory) next.set('history', 'open'); else next.delete('history'); return next; }); }
  if (!overview.data) {
    if (overview.isPending) return <LoadingState label={`Loading ${symbol} research workspace`} />;
    const missing = overview.error instanceof ApiError && overview.error.status === 404;
    return <><ErrorState title={missing ? 'Stock not found' : 'Stock Research unavailable'} description={missing ? 'This symbol is not stored locally. Add and confirm it from your Watchlist first.' : requestError(overview.error)} backTo="/" /><Button onClick={() => void overview.refetch()}>Retry</Button></>;
  }
  const data = overview.data, stock = data.stock;
  const jobs = [{ name: 'Price', query: priceJob }, { name: 'SEC', query: secJob }];
  const busy = sync.isPending || data.syncActive || jobs.some(({ query }) => query.data && ['QUEUED', 'RUNNING'].includes(query.data.status));
  return <div className="page stock-page">
    <StockHeader overview={data} onSync={() => { setFullHistory(!stock.lastPrice); sync.reset(); setSyncOpen(true); }} syncing={busy} />
    {overview.isError && <Alert type="warning" title="Workspace refresh failed; showing saved cache." description={requestError(overview.error)} />}
    {stock.freshness === 'stale' && <Alert type="warning" title="Market data is stale" description="The latest stored EOD close remains available. Refresh explicitly with Sync Data." />}
    {stock.lastSyncJob && ['FAILED', 'INTERRUPTED'].includes(stock.lastSyncJob.status) && <Alert type="warning" title="Last market-data sync did not complete" description={stock.lastSyncJob.errorCode ?? 'Saved observations have been retained.'} />}
    {stock.lastSyncJob && ['QUEUED', 'RUNNING'].includes(stock.lastSyncJob.status) && <Alert type={data.syncActive ? 'info' : 'warning'} title={data.syncActive ? `Market-data sync: ${stock.lastSyncJob.status}` : 'Previous sync heartbeat expired; retry explicitly with Sync Data.'} />}
    {jobs.map(({ name, query }) => query.data ? <Alert key={name} type={query.data.status === 'SUCCEEDED' ? 'success' : ['FAILED', 'INTERRUPTED'].includes(query.data.status) ? 'warning' : 'info'} title={`${name} sync: ${query.data.status}`} description={query.data.errorCode ?? undefined} /> : query.isError ? <Alert key={name} type="warning" title={`${name} job status unavailable`} /> : null)}
    <Tabs className="stock-tabs" activeKey={activeTab} onChange={key => updateParams(key === 'price-volume' ? 'price-volume' : 'overview')} items={[
      { key: 'overview', label: 'Overview', children: <OverviewSections data={data} range={range} onRange={setRange} onHistory={record => { setSelected(record ?? null); updateParams('overview', true); }} /> },
      { key: 'price-volume', label: 'Price & Volume', children: <PriceVolumeWorkspace data={data} active={activeTab === 'price-volume'} onResearch={record => { setSelected(record); updateParams('price-volume', true); }} /> },
    ]} />
    <ResearchHistoryDrawer open={historyOpen} symbol={symbol} onClose={() => updateParams(activeTab)} records={history.data ?? data.history} selected={selected} onSelect={setSelected} />
    {historyOpen && history.isError && <Alert type="warning" title="Research history could not be refreshed" />}
    <Modal title="Sync Stock Data" open={syncOpen} onCancel={() => !sync.isPending && setSyncOpen(false)} footer={<Space><Button disabled={sync.isPending} onClick={() => setSyncOpen(false)}>Cancel</Button><Button type="primary" loading={sync.isPending} onClick={() => sync.mutate()}>Start Sync</Button></Space>}>
      <p>This explicitly requests Tiingo history for {stock.symbol}. Your stored data is preserved if the request fails.</p>
      <Checkbox checked={fullHistory || !stock.lastPrice} disabled={!stock.lastPrice || sync.isPending} onChange={event => setFullHistory(event.target.checked)}>Import all provider-available history (up to 50 years)</Checkbox>
      <p>{stock.lastPrice && !fullHistory ? 'Incremental update with a seven-day overlap.' : 'Full history may consume several provider requests.'}</p>
      <Checkbox checked={includeSec} disabled={sync.isPending} onChange={event => setIncludeSec(event.target.checked)}>Also synchronize SEC filings and fundamentals</Checkbox>
      {sync.isError && <Alert type="error" title="Sync could not be fully started" description={sync.error.message} />}
    </Modal>
  </div>;
}
export function StockResearchPage() {
  const { symbol: rawSymbol } = useParams();
  const symbol = normalizeStockSymbol(rawSymbol);
  if (!symbol) return <ErrorState title="Invalid stock symbol" description="Choose a stock from your Watchlist or enter a valid ticker symbol." backTo="/" />;
  return <StockWorkspace key={symbol} symbol={symbol} />;
}
