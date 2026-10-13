import { useLocation } from 'react-router-dom';
import { DataStatusIndicator } from './DataStatusIndicator';
import { StockSearch } from './StockSearch';
import { useQuery } from '@tanstack/react-query';
import { DEFAULT_WATCHLIST_FILTERS, watchlistQuery } from '../api/watchlist';

export function GlobalHeader() {
  const location = useLocation();
  const watchlist = useQuery({ ...watchlistQuery(DEFAULT_WATCHLIST_FILTERS), enabled: location.pathname === '/' });
  const prices = watchlist.data?.items.filter(row => !!row.lastPrice) ?? [];
  const latestDate = prices.map(row => row.lastPrice!.tradingDate).sort().at(-1);
  const section = location.pathname === '/' ? 'Watchlist'
    : location.pathname === '/settings' ? 'Data & Settings' : 'Stock Research';

  return (
    <header className="global-header">
      <div className="global-header__location"><span>WORKSPACE</span><span className="global-header__slash">/</span><strong>{section}</strong></div>
      <StockSearch />
      <div className="global-header__status"><DataStatusIndicator status={location.pathname !== '/' || !prices.length ? 'none' : prices.every(row => row.fresh) ? 'fresh' : 'stale'} asOf={latestDate} /></div>
    </header>
  );
}
