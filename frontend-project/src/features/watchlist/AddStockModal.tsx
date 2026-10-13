import { useState } from 'react';
import { Alert, Button, Checkbox, Input, Modal, Radio, Space, Tag } from 'antd';
import { CheckCircleOutlined, SearchOutlined } from '@ant-design/icons';
import { useMutation } from '@tanstack/react-query';
import { addWatchlist, requestError, resolveInstrument, searchInstruments, type AddResponse, type Resolution } from '../../api/watchlist';

export function initialHistoryDate() { const day = new Date(); day.setUTCFullYear(day.getUTCFullYear() - 1); return day.toISOString().slice(0, 10); }
export function AddStockModal({ onClose, onAdded }: { onClose: () => void; onAdded: (response: AddResponse) => void }) {
  const [query, setQuery] = useState(''), [resolved, setResolved] = useState<Resolution | null>(null);
  const [importHistory, setImportHistory] = useState(false), [startDate, setStartDate] = useState(initialHistoryDate);
  const [mode, setMode] = useState<'search' | 'ticker'>('search');
  const search = useMutation({ mutationFn: searchInstruments });
  const resolve = useMutation({ mutationFn: resolveInstrument, onSuccess: setResolved });
  const add = useMutation({ mutationFn: () => addWatchlist(resolved!.resolutionToken, importHistory ? startDate : undefined), onSuccess: onAdded });
  const busy = search.isPending || resolve.isPending || add.isPending;
  const error = add.error ?? resolve.error ?? search.error;
  function submitSearch() {
    setResolved(null); resolve.reset(); add.reset();
    if (query.trim()) { if (mode === 'ticker') { search.reset(); resolve.mutate(query.trim()); } else search.mutate(query.trim()); }
  }
  return <Modal open title="Add Stock" onCancel={() => { if (!add.isPending) onClose(); }} className="add-stock-modal" width={580}
    footer={<Space><Button onClick={onClose} disabled={add.isPending}>Cancel</Button><Button type="primary" loading={add.isPending} disabled={!resolved || resolved.alreadyAdded || busy || (importHistory && !startDate)} onClick={() => add.mutate()}>Confirm Add Stock</Button></Space>}>
    <p className="modal-intro">Find a company, then confirm its listing. Prices are imported only if you choose to download history.</p>
    <Radio.Group value={mode} onChange={event => { setMode(event.target.value as 'search' | 'ticker'); setResolved(null); search.reset(); resolve.reset(); }} options={[{ value: 'search', label: 'Ticker or company search' }, { value: 'ticker', label: 'Resolve exact ticker' }]} />
    <form className="instrument-search-form" onSubmit={event => { event.preventDefault(); if (!busy) submitSearch(); }}>
      <Input aria-label="Ticker or company name" disabled={busy} placeholder={mode === 'search' ? 'Search ticker or company name' : 'Enter exact ticker'} value={query} maxLength={100} onChange={event => { setQuery(event.target.value); setResolved(null); search.reset(); resolve.reset(); add.reset(); }} />
      <Button aria-label={mode === 'search' ? 'Search' : 'Resolve'} htmlType="submit" type="primary" icon={<SearchOutlined />} loading={search.isPending || resolve.isPending} disabled={!query.trim() || add.isPending}>{mode === 'search' ? 'Search' : 'Resolve'}</Button>
    </form>
    {error && <Alert showIcon type="error" title={requestError(error)} />}
    {search.data?.warning && <Alert type="warning" title={search.data.warning.message} />}
    {search.data && !resolved && <div className="instrument-results" aria-label="Search results">
      {!search.data.results.length ? <p>No matching supported stocks. Try an exact ticker.</p> : search.data.results.map(result => <button type="button" key={result.symbol} disabled={busy} onClick={() => resolve.mutate(result.symbol)}>
        <strong>{result.symbol}</strong><span>{result.name}</span><small>Review listing →</small>
      </button>)}
    </div>}
    {resolved && <section className="resolved-instrument" aria-label="Confirmed instrument identity">
      <CheckCircleOutlined /><div><strong>{resolved.symbol}</strong><p>{resolved.company}</p><Tag>{resolved.exchange}</Tag><Tag>{resolved.currency}</Tag></div>
      {resolved.alreadyAdded && <Alert type="info" title="Already in your Watchlist" />}
    </section>}
    <div className="history-import-choice">
      <Checkbox checked={importHistory} disabled={busy} onChange={event => setImportHistory(event.target.checked)}>Import daily price history after adding</Checkbox>
      {importHistory && <label>Import from <Input aria-label="Historical import start date" type="date" value={startDate} max={new Date().toISOString().slice(0, 10)} onChange={event => setStartDate(event.target.value)} /></label>}
      <small>Uses your Tiingo quota. Adding alone saves identity and Watchlist membership.</small>
    </div>
  </Modal>;
}
