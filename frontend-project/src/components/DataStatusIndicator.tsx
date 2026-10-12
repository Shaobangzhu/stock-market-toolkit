export type DataStatus = 'none' | 'fresh' | 'stale' | 'unavailable';

const labels: Record<DataStatus, string> = {
  none: 'No market data yet',
  fresh: 'Market data current',
  stale: 'Market data needs refresh',
  unavailable: 'Market data unavailable',
};

export function DataStatusIndicator({ status, asOf }: { status: DataStatus; asOf?: string }) {
  return (
    <span className={`data-status data-status--${status}`} aria-label={labels[status]}>
      <span className="data-status__dot" aria-hidden="true" />
      <span>{labels[status]}{asOf ? ` · ${asOf}` : ''}</span>
    </span>
  );
}
