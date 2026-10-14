import { useState } from 'react';
import { Alert, Button, Collapse, Input, Modal, Select, Space, Table } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { calculateValuation, saveValuation, valuationError, valuationQuery, valuationSources, type Assumptions, type Calculation, type CaseAssumption, type CaseName, type SavedScenario } from '../../api/valuation';
import { formatFinancialValue } from '../../utils/format';

const names: CaseName[] = ['bear', 'base', 'bull'];
const label = (name: CaseName) => `${name[0]!.toUpperCase()}${name.slice(1)} Case`;
function blankCase(): CaseAssumption { return { method: 'DIRECT', fairValue: '', rationale: '', entry: { mode: 'MARGIN', minimumSafety: '', maximumSafety: '' }, hypotheticalPrice: null }; }
const blank = (exchange: string): Assumptions => ({ exchange, cutoff: new Date().toISOString(), cases: { bear: blankCase(), base: blankCase(), bull: blankCase() } });
const pct = (v: string | null) => v === null ? 'N/A' : `${v}%`;
export function ValuationWorkspace({ symbol, exchange, currency }: { symbol: string; exchange: string; currency: string }) {
  const client = useQueryClient(), saved = useQuery(valuationQuery(symbol, exchange));
  const [open, setOpen] = useState(false), [assumptions, setAssumptions] = useState<Assumptions>(() => blank(exchange));
  const [editing, setEditing] = useState<SavedScenario | undefined>(), [calculation, setCalculation] = useState<Calculation | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const sources = useQuery(valuationSources(symbol, exchange, assumptions.cutoff, open));
  const calculate = useMutation({ mutationFn: () => calculateValuation(symbol, assumptions), onSuccess: setCalculation });
  const save = useMutation({ mutationFn: () => saveValuation(symbol, calculation!, editing), onSuccess: async () => {
    setOpen(false); setNotice('Scenario saved as an immutable version.');
    await client.invalidateQueries({ queryKey: ['stock', symbol] }); await client.invalidateQueries({ queryKey: ['watchlist'] });
  } });
  const busy = calculate.isPending || save.isPending;
  function change(next: Assumptions) { setAssumptions(next); setCalculation(null); calculate.reset(); save.reset(); }
  function changeCase(name: CaseName, value: CaseAssumption) { change({ ...assumptions, cases: { ...assumptions.cases, [name]: value } }); }
  function begin(row?: SavedScenario) { setEditing(row); change(row ? structuredClone(row.assumptions) : blank(exchange)); setNotice(null); setOpen(true); }
  const latest = saved.data?.[0];
  const displayed = calculation?.result;
  const snapshot = calculation?.inputSnapshot ?? sources.data;
  const text = (name: CaseName, title: string, value: string, set: (value: string) => void) => <label className="valuation-field">{title}<Input aria-label={`${label(name)} ${title}`} value={value} disabled={busy} onChange={e => set(e.target.value)} /></label>;
  return <section className="valuation-workspace" aria-label="Valuation and Entry Intelligence">
    <p>Transparent Bear / Base / Bull estimates. Financial arithmetic runs in the local backend.</p>
    {notice && <Alert type="success" title={notice} />}
    {saved.isError && <Alert type="warning" title="Saved scenarios unavailable" description={valuationError(saved.error)} action={<Button onClick={() => void saved.refetch()}>Retry scenarios</Button>} />}
    {!latest && !saved.isPending && !saved.isError && <p>Create a scenario to compare your assumptions.</p>}
    {latest && <><p>Saved v{latest.version} · {latest.createdAt.slice(0, 10)} · cutoff {latest.assumptions.cutoff}</p><p>Model-derived fair-value range: {formatFinancialValue(latest.result.fairValueRange.lower, currency)} – {formatFinancialValue(latest.result.fairValueRange.upper, currency)}</p></>}
    <Space wrap><Button type="primary" onClick={() => begin()}>Create Scenario</Button>{latest && <Button onClick={() => begin(latest)}>Edit Assumptions</Button>}</Space>
    {saved.data && saved.data.length > 0 && <Collapse items={[{ key: 'history', label: 'Review saved calculations (latest 50 versions)', children: saved.data.map(row => <div key={row.id} className="valuation-version"><span>{row.createdAt.slice(0, 19)} · v{row.version} · {row.seriesId.slice(0, 8)}</span><Button onClick={() => begin(row)}>Review / edit v{row.version}</Button><details><summary>Saved calculation details</summary><pre>{JSON.stringify(row, null, 2)}</pre></details></div>) }]} />}
    <Modal className="valuation-modal" title={`${symbol} · Valuation & Entry Intelligence`} open={open} width={1160} onCancel={() => !busy && setOpen(false)} footer={<Space wrap><Button disabled={busy} onClick={() => change(editing ? structuredClone(editing.assumptions) : blank(exchange))}>Reset</Button><Button loading={calculate.isPending} disabled={save.isPending} onClick={() => { setCalculation(null); calculate.mutate(); }}>Calculate</Button><Button type="primary" disabled={!calculation || calculate.isPending || save.isSuccess} loading={save.isPending} onClick={() => save.mutate()}>Save Scenario</Button></Space>}>
      <p>Model-derived estimates for personal research. No return is guaranteed. All rates are percentages, all prices are {currency} per raw share. Bear fair value must be ≤ Base ≤ Bull.</p>
      <p>Enter decimal values without separators. Growth must be greater than −100% and at most 1,000%; discount rate 0–100%; target multiple greater than 0 and at most 1,000. Planned safety must be 0% to below 100%, with minimum ≤ maximum. Prices and share counts must be positive.</p>
      <label className="valuation-field">Data cutoff (UTC)<Input aria-label="Data cutoff (UTC)" value={assumptions.cutoff} disabled={busy} onChange={e => change({ ...assumptions, cutoff: e.target.value })} /></label>
      <p>Historical sources must have been published and locally retrieved by cutoff. Assumptions entered now are retrospective. Use ISO UTC format, e.g. YYYY-MM-DDTHH:mm:ss.sssZ.</p>
      {sources.isError && <Alert type="warning" title="Financial sources unavailable" description={valuationError(sources.error)} />}
      {snapshot && <Alert type={snapshot.price?.stale ? 'warning' : 'info'} title={snapshot.price ? `Reference EOD: ${snapshot.price.close} ${currency} · ${snapshot.price.tradingDate} · TIINGO RAW${snapshot.price.stale ? ' · stale at cutoff' : ''}` : 'No price available at cutoff. Current-price metrics will be N/A.'} />}
      <div className="valuation-cases">{names.map(name => {
        const c = assumptions.cases[name];
        const set = (patch: object) => changeCase(name, { ...c, ...patch } as CaseAssumption);
        return <section key={name} className="valuation-case"><h3>{label(name)}</h3>
          <label className="valuation-field">Methodology<Select aria-label={`${label(name)} Methodology`} value={c.method} disabled={busy} options={[{ value: 'DIRECT', label: 'User-estimated fair value' }, { value: 'PE', label: 'Annual EPS × target P/E' }, { value: 'PS', label: 'Annual revenue × target P/S' }]} onChange={method => changeCase(name, method === 'DIRECT' ? { ...blankCase(), entry: c.entry, hypotheticalPrice: c.hypotheticalPrice } : { method, factId: '', growthPercent: '', horizonYears: 0, targetMultiple: '', discountPercent: '', shareBasisNote: '', entry: c.entry, hypotheticalPrice: c.hypotheticalPrice, ...(method === 'PS' ? { forecastShares: '' } : {}) } as CaseAssumption)} /></label>
          {c.method === 'DIRECT' ? <>{text(name, 'Fair value', c.fairValue, fairValue => set({ fairValue }))}{text(name, 'Rationale / source', c.rationale, rationale => set({ rationale }))}</> : <>
            <label className="valuation-field">Annual SEC fact<Select aria-label={`${label(name)} Annual SEC fact`} value={c.factId || undefined} placeholder="Choose a published annual fact" disabled={busy || sources.isPending} options={(sources.data?.facts ?? []).filter(f => f.metric === (c.method === 'PE' ? 'EPS' : 'REVENUE') && f.unit === `${currency}${c.method === 'PE' ? '/shares' : ''}`).map(f => ({ value: f.id, label: `${f.periodStart}–${f.periodEnd} · ${f.value} ${f.unit} · ${f.concept} · ${f.accessionNumber}` }))} onChange={factId => set({ factId })} /></label>
            {text(name, 'Annual growth (%)', c.growthPercent, growthPercent => set({ growthPercent }))}
            {text(name, 'Forecast horizon (whole years, 0–30)', String(c.horizonYears), value => set({ horizonYears: value === '' ? NaN : Number(value) }))}
            {text(name, 'Target equity multiple', c.targetMultiple, targetMultiple => set({ targetMultiple }))}
            {text(name, 'Equity discount rate (%)', c.discountPercent, discountPercent => set({ discountPercent }))}
            {c.method === 'PS' && text(name, 'Assumed forecast diluted shares', c.forecastShares, forecastShares => set({ forecastShares }))}
            {text(name, 'Share-basis verification / dilution assumptions', c.shareBasisNote, shareBasisNote => set({ shareBasisNote }))}
            <p>Confirm the reported EPS share basis (P/E) or assumed future diluted share count (P/S). No automatic split/dilution conversion. Single listed class only. Discounted terminal equity price excludes interim cash flows.</p>
          </>}
          <label className="valuation-field">Entry range method<Select aria-label={`${label(name)} Entry range method`} value={c.entry.mode} disabled={busy} options={[{ value: 'MARGIN', label: 'User-selected safety range' }, { value: 'MANUAL', label: 'Manual price range' }]} onChange={mode => set({ entry: mode === 'MARGIN' ? { mode, minimumSafety: '', maximumSafety: '' } : { mode, lower: '', upper: '' } })} /></label>
          {c.entry.mode === 'MARGIN' ? <>{text(name, 'Minimum planned safety (%)', c.entry.minimumSafety, minimumSafety => set({ entry: { ...c.entry, minimumSafety } }))}{text(name, 'Maximum planned safety (%)', c.entry.maximumSafety, maximumSafety => set({ entry: { ...c.entry, maximumSafety } }))}</> : <>{text(name, 'Entry lower price', c.entry.lower, lower => set({ entry: { ...c.entry, lower } }))}{text(name, 'Entry upper price', c.entry.upper, upper => set({ entry: { ...c.entry, upper } }))}</>}
          {text(name, 'Hypothetical entry price (optional)', c.hypotheticalPrice ?? '', hypotheticalPrice => set({ hypotheticalPrice: hypotheticalPrice || null }))}
        </section>;
      })}</div>
      {(calculate.isError || save.isError) && <Alert type="error" title="Scenario could not be completed" description={valuationError(calculate.error ?? save.error)} />}
      {displayed && <><h3>Compare Bear / Base / Bull</h3><p>Fair-value range: {displayed.fairValueRange.lower} – {displayed.fairValueRange.upper} {currency}. Base Case entry zone is used on Watchlist and charts.</p><Table rowKey="name" pagination={false} scroll={{ x: 1250 }} dataSource={displayed.cases} columns={[
        { title: 'Case', dataIndex: 'name', render: (v: CaseName) => label(v) }, { title: 'Fair value', dataIndex: 'fairValue' },
        { title: 'Entry zone', render: (_, r) => `${r.entryZone.lower} – ${r.entryZone.upper}` },
        { title: 'Current-price MOS', dataIndex: 'currentPriceMarginOfSafetyPercent', render: pct },
        { title: 'Current premium (+) / discount (−)', dataIndex: 'currentPricePremiumPercent', render: pct },
        { title: 'Planned MOS at lower / upper', render: (_, r) => `${pct(r.plannedEntryMarginOfSafetyPercent.atLower)} / ${pct(r.plannedEntryMarginOfSafetyPercent.atUpper)}` },
        { title: 'Hypothetical-entry MOS', dataIndex: 'hypotheticalMarginOfSafetyPercent', render: pct },
        { title: 'Distance to entry', dataIndex: 'distanceToEntryPercent', render: pct },
      ]} /><p>Distance: negative below the lower boundary, zero inside the zone, positive above the upper boundary. Current metrics use the displayed saved EOD reference, not a live price.</p>
      <Collapse items={[{ key: 'details', label: 'Review Calculation Details', children: <><p>Fair = metric × (1 + growth/100)^years × multiple ÷ (1 + discount/100)^years; P/S also divides by assumed forecast shares. MOS = (fair − reference) / fair × 100. Safety entry range = fair × (1 − maximum safety/100) through fair × (1 − minimum safety/100). Prices round half-up to 8 decimal places before entry and ratio calculations.</p><ul>{displayed.limitations.map(item => <li key={item}>{item}</li>)}</ul><pre>{JSON.stringify(calculation, null, 2)}</pre></> }]} /></>}
    </Modal>
  </section>;
}
