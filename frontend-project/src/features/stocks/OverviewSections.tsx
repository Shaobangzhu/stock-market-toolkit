import { lazy, Suspense, type ReactNode } from 'react';
import { ValuationWorkspace } from './ValuationWorkspace';
import { Alert, Button, Radio, Table, Tooltip } from 'antd';
import { ArrowRightOutlined, ExperimentOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { EmptyState, LoadingState } from '../../components/States';
import { PRICE_RANGES, filingsQuery, fundamentalsQuery, overviewQuery, safeOfficialUrl, safeResearchUrl, type PriceRange, type ResearchRecord, type FinancialMetric, type StockOverview } from '../../api/stocks';
import { requestError } from '../../api/watchlist';
import { formatFinancialValue } from '../../utils/format';
const PerformanceChart = lazy(async () => ({ default: (await import('./PricePerformanceChart')).PricePerformanceChart }));
export const displayNumber = (value: string | null | undefined, digits = 2) => value == null ? 'N/A' : Number.isFinite(Number(value)) && Math.abs(Number(value)) <= Number.MAX_SAFE_INTEGER ? new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(Number(value)) : value;
const percent = (value: string | null | undefined) => value == null ? 'N/A' : `${displayNumber(value)}%`;
const rangeValue = (value: { lower: string; upper: string; currency: string } | null) => value ? `${formatFinancialValue(value.lower, value.currency)} – ${formatFinancialValue(value.upper, value.currency)}` : 'N/A';
function MetricRow({ label, value, detail }: { label: string; value: string; detail?: string }) { return <div className="overview-metric-row"><span>{label}{detail && <small>{detail}</small>}</span><strong>{value}</strong></div>; }
export function OverviewPanel({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) { return <section className="panel overview-panel"><div className="panel__header"><h2>{title}</h2>{action}</div>{children}</section>; }
function FinancialRow({ label, metric }: { label: string; metric?: FinancialMetric }) {
  const value = !metric || metric.value === null ? 'N/A' : metric.unit === 'percent' ? percent(metric.value) : metric.unit === 'ratio' ? `${displayNumber(metric.value)}×` : /^[A-Z]{3}$/.test(metric.unit) ? formatFinancialValue(metric.value, metric.unit) : `${displayNumber(metric.value)} ${metric.unit}`;
  const source = safeOfficialUrl(metric?.sources[0]?.sourceUrl);
  return <div><MetricRow label={label} value={value} detail={metric?.value === null ? metric.reason?.replaceAll('_', ' ').toLowerCase() : metric?.derived ? `Derived · ${metric.method ?? 'documented SEC method'}` : undefined} />{source && <a className="financial-source" href={source} target="_blank" rel="noopener noreferrer">SEC source · filed {metric!.sources[0]!.filedDate}</a>}</div>;
}
export function OverviewSections({ data, range, onRange, onHistory }: { data: StockOverview; range: PriceRange; onRange: (range: PriceRange) => void; onHistory: (record?: ResearchRecord) => void }) {
  const stock = data.stock;
  const performance = useQuery(overviewQuery(stock.symbol, range));
  const fundamentals = useQuery(fundamentalsQuery(stock.symbol));
  const filings = useQuery(filingsQuery(stock.symbol));
  const p = performance.data?.performance;
  const annual = fundamentals.data?.periods.find(period => period.periodKind === 'ANNUAL');
  const instant = fundamentals.data?.periods.find(period => period.periodKind === 'INSTANT');
  const secUrl = safeOfficialUrl(data.company.secUrl);
  return <div className="stock-overview">
    <div className="research-overview-grid">
      <div className="research-overview-main">
        <OverviewPanel title="Price Performance" action={<Radio.Group size="small" value={range} onChange={event => onRange(event.target.value as PriceRange)} aria-label="Price performance range">{PRICE_RANGES.map(value => <Radio.Button key={value} value={value}>{value}</Radio.Button>)}</Radio.Group>}>
          {performance.isPending ? <LoadingState label="Loading price performance" /> : !p ? <><Alert type="error" title="Price performance unavailable" description={requestError(performance.error)} /><Button onClick={() => void performance.refetch()}>Retry price data</Button></> : p.observations === 0 ? <EmptyState title="No price history yet" description="Use Sync Data to explicitly import historical daily prices." /> : <>
            {performance.isError && <Alert type="warning" title="Price refresh failed; showing previously cached observations." />}
            <div className="performance-summary"><strong className={p.change && Number(p.change.percent) > 0 ? 'market-positive' : p.change && Number(p.change.percent) < 0 ? 'market-negative' : ''}>{p.change ? `${Number(p.change.percent) > 0 ? '+' : ''}${percent(p.change.percent)}` : 'Period change N/A'}</strong><span>{p.observedFrom} – {p.through} · {p.adjustmentMode === 'TOTAL_RETURN' ? 'Total-return adjusted' : 'Raw'} · {p.provider}</span></div>
            <Suspense fallback={<LoadingState label="Loading price chart" />}><PerformanceChart performance={p} /></Suspense>
            <p className="chart-caption">{p.coverage === 'verified-stored-window' ? 'Verified stored sessions' : 'Incomplete or unverified coverage'} · {p.observations} stored observations. Gaps are preserved; returns use observed endpoints.</p>
          </>}
          <div className="performance-stat-grid"><MetricRow label="52-week high" value={stock.range52Week ? formatFinancialValue(stock.range52Week.high, stock.currency) : 'N/A'} detail={stock.range52Week?.coverage === 'partial' ? 'Partial RAW coverage' : 'Stored RAW prices'} /><MetricRow label="52-week low" value={stock.range52Week ? formatFinancialValue(stock.range52Week.low, stock.currency) : 'N/A'} /><MetricRow label="Historical volatility" value={percent(p?.volatility)} detail="Annualized · selected window" /><MetricRow label="Average trading volume" value={p?.averageVolume ? `${displayNumber(p.averageVolume, 0)} shares` : 'N/A'} detail="Stored RAW daily observations" /></div>
          {p && <p className="chart-caption">{p.volatilityMethod}</p>}
        </OverviewPanel>
        <OverviewPanel title="Company Overview">
          <h3>{data.company.name}</h3><p>{data.company.description ?? 'Company description is not available in the local data cache.'}</p>
          <div className="company-info-grid"><MetricRow label="Sector" value={data.company.sector ?? 'N/A'} /><MetricRow label="Industry" value={data.company.industry ?? 'N/A'} /><MetricRow label="Exchange" value={stock.exchange} /><MetricRow label="Currency" value={stock.currency} /></div>
          {secUrl && <a href={secUrl} target="_blank" rel="noopener noreferrer">Official SEC company filings</a>}
          {!secUrl && <p>Official company and SEC links become available when verified metadata is stored.</p>}
          {filings.isError && <Alert type="warning" title="SEC filings unavailable" description={requestError(filings.error)} />}
          {filings.data?.filings.length ? <div className="overview-filing-links">{filings.data.filings.map(filing => { const url = safeOfficialUrl(filing.sourceUrl); return url ? <a key={filing.id} href={url} target="_blank" rel="noopener noreferrer">{filing.form} · filed {filing.filedDate}{filing.reportPeriod ? ` · period ${filing.reportPeriod}` : ''}</a> : null; })}</div> : <p>No SEC filings stored yet.</p>}
        </OverviewPanel>
      </div>
      <div className="research-overview-side">
        <OverviewPanel title="Valuation Snapshot">
          {fundamentals.isPending ? <LoadingState label="Loading company fundamentals" /> : <>
            {fundamentals.isError && <Alert type="warning" title="Company fundamentals unavailable" description={requestError(fundamentals.error)} />}
            {fundamentals.data && fundamentals.data.freshness.status !== 'cached' && <Alert type="warning" title={fundamentals.data.freshness.status === 'stale' ? 'SEC fundamentals are stale' : 'No SEC fundamentals stored'} />}
            <p>{annual ? `Annual period: ${annual.periodStart} – ${annual.periodEnd} · ${annual.currency}` : 'No comparable annual fundamentals available.'}</p>
            <FinancialRow label="Market capitalization" metric={fundamentals.data?.valuation.marketCapitalization} />
            <FinancialRow label="P/E (annual, not TTM)" metric={fundamentals.data?.valuation.priceEarnings} /><FinancialRow label="P/S (annual, not TTM)" metric={fundamentals.data?.valuation.priceSales} />
            <FinancialRow label="Revenue growth (YoY)" metric={annual?.metrics.revenueGrowth} /><FinancialRow label="Free cash flow (derived)" metric={annual?.metrics.freeCashFlow} /><FinancialRow label="Revenue" metric={annual?.metrics.revenue} /><FinancialRow label="Net income" metric={annual?.metrics.netIncome} /><FinancialRow label="Operating margin" metric={annual?.metrics.operatingMargin} /><FinancialRow label="Net margin" metric={annual?.metrics.netMargin} />
            {instant && <><p>Balance sheet date: {instant.periodEnd}</p><FinancialRow label="Cash and equivalents" metric={instant.metrics.cashAndEquivalents} /><FinancialRow label="Total debt" metric={instant.metrics.totalDebt} /></>}
            {fundamentals.data?.valuation.marketObservation && <p className="chart-caption">Valuation quote date: {fundamentals.data.valuation.marketObservation.tradingDate}. Availability and reporting comparability are checked by the backend.</p>}
          </>}
        </OverviewPanel>
        <OverviewPanel title="Entry Research">
          {!stock.entryZone && !stock.fairValue && <p>No valuation scenario saved yet.</p>}
          <MetricRow label="Saved fair-value interval" value={rangeValue(stock.fairValue)} /><MetricRow label="Target entry zone" value={rangeValue(stock.entryZone)} /><MetricRow label="Current margin of safety" value={percent(data.marginOfSafety)} detail={data.marginOfSafetyReason} /><MetricRow label="Distance to entry" value={percent(stock.distanceToEntry)} detail="Nearest saved boundary · comparable share basis required" />
          {stock.entryZone && <p className="chart-caption">Saved {stock.entryZone.savedAt.slice(0, 10)} · {stock.entryZone.method} · {stock.entryZone.basis}</p>}
          <ValuationWorkspace key={stock.instrumentId} symbol={stock.symbol} exchange={stock.exchange} currency={stock.currency} />
        </OverviewPanel>
      </div>
    </div>
    <OverviewPanel title="News & AI" action={<Tooltip title="The AI research service is not implemented yet."><span><Button type="primary" disabled icon={<ExperimentOutlined />}>Generate AI Research</Button></span></Tooltip>}>
      <p>Last AI report: {stock.latestResearch ? stock.latestResearch.completedAt.slice(0, 10) : 'Not Researched'}</p>
      {stock.latestResearch?.summary && <p className="saved-research-summary">{stock.latestResearch.summary}</p>}
      <div className="news-research-grid"><div><h3>Recent research headlines</h3>{data.news.headlines.length ? <ul>{data.news.headlines.map((headline, index) => <li key={index}><a href={safeResearchUrl(headline.url)} target="_blank" rel="noopener noreferrer">{headline.title}</a>{headline.publishedAt && <small> · {headline.publishedAt.slice(0, 10)}</small>}</li>)}</ul> : <p>No sourced recent research headlines saved yet.</p>}</div>
        {([{ title: 'Bullish drivers', values: data.news.bullishDrivers }, { title: 'Bearish risks', values: data.news.bearishRisks }, { title: 'Key catalysts', values: data.news.catalysts }]).map(({ title, values }) => <div key={title}><h3>{title}</h3>{values.length ? <ul>{values.map((point, index) => <li key={index}>{point.text}<div>{point.sources.map((source, i) => <a key={i} href={safeResearchUrl(source.url)} target="_blank" rel="noopener noreferrer">Source {i + 1}</a>)}</div></li>)}</ul> : <p>No sourced {title.toLowerCase()} saved yet.</p>}</div>)}
      </div>
      <p className="chart-caption">Research runs only after an explicit action when the AI service is available.</p>
    </OverviewPanel>
    <OverviewPanel title={`${stock.symbol} — Research History`} action={<Button type="link" icon={<ArrowRightOutlined aria-label="View research" />} onClick={() => onHistory()}>View All</Button>}>
      {data.history.length === 0 ? <EmptyState title="No research history yet" description="Save an entry scenario or thesis note to start your history. AI reports appear here when available." /> : <Table<ResearchRecord> rowKey="id" pagination={false} dataSource={data.history.slice(0,5)} scroll={{ x: 800 }} onRow={record => ({ onClick: () => onHistory(record) })} columns={[
        { title: 'Research Date', key: 'date', render: (_, record) => <Button type="link" onClick={() => onHistory(record)}>{record.completedAt.slice(0, 10)}</Button> },
        { title: 'Type', dataIndex: 'type' }, { title: 'Fair Value', key: 'fair', render: (_, record) => rangeValue(record.fairValue) }, { title: 'Version', key: 'version', render: (_, record) => `v${record.version}` },
        { title: 'Notes / Summary', key: 'summary', render: (_, record) => record.summary || 'No saved summary' },
      ]} />}
    </OverviewPanel>
  </div>;
}
