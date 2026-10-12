import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppProviders } from './app/providers';
import { AppShell } from './components/AppShell';
import { ErrorState, LoadingState } from './components/States';
import { WatchlistPage } from './features/watchlist/WatchlistPage';

const StockResearchPage = lazy(() => import('./features/stocks/StockResearchPage').then(({ StockResearchPage }) => ({ default: StockResearchPage })));
const SettingsPage = lazy(() => import('./features/settings/SettingsPage').then(({ SettingsPage }) => ({ default: SettingsPage })));

export default function App() {
  return (
    <AppProviders>
      <BrowserRouter>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<WatchlistPage />} />
            <Route path="stocks/:symbol" element={<Suspense fallback={<LoadingState label="Loading stock research" />}><StockResearchPage /></Suspense>} />
            <Route path="settings" element={<Suspense fallback={<LoadingState label="Loading settings" />}><SettingsPage /></Suspense>} />
            <Route path="stocks" element={<Navigate to="/" replace />} />
            <Route path="*" element={<ErrorState title="Page not found" description="This location is not part of Stock Research Lab." backTo="/" />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AppProviders>
  );
}
