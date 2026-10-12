import { useState } from 'react';
import { Outlet, useMatch } from 'react-router-dom';
import { GlobalHeader } from './GlobalHeader';
import { Sidebar } from './Sidebar';

export function AppShell() {
  const [collapsed, setCollapsed] = useState(false);
  const stockMatch = useMatch('/stocks/:symbol');
  const currentSymbol = stockMatch?.params.symbol;

  return (
    <div className={`app-shell${collapsed ? ' app-shell--collapsed' : ''}`}>
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((current) => !current)} currentSymbol={currentSymbol} />
      <div className="app-shell__workspace">
        <GlobalHeader />
        <main className="app-main" id="main-content"><Outlet /></main>
      </div>
    </div>
  );
}
