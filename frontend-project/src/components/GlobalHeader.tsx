import { useLocation } from 'react-router-dom';
import { DataStatusIndicator } from './DataStatusIndicator';
import { StockSearch } from './StockSearch';

export function GlobalHeader() {
  const location = useLocation();
  const section = location.pathname === '/' ? 'Watchlist'
    : location.pathname === '/settings' ? 'Data & Settings' : 'Stock Research';

  return (
    <header className="global-header">
      <div className="global-header__location"><span>WORKSPACE</span><span className="global-header__slash">/</span><strong>{section}</strong></div>
      <StockSearch />
      <div className="global-header__status"><DataStatusIndicator status="none" /></div>
    </header>
  );
}
