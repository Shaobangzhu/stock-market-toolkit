# Frontend foundation

This app uses React 19, TypeScript 5, Vite 8, Ant Design 6, ECharts 6, React Router 7, and TanStack Query 5. Run with Node.js 24 or a compatible Node.js 22 release.

```bash
npm ci
npm run dev
npm run typecheck
npm run build
npm test
```

The development server listens on `127.0.0.1:5173`. Open the exact origin configured as backend `FRONTEND_ORIGIN` (template default `http://localhost:5173`; this machine currently `http://127.0.0.1:5173`). Vite proxies `/api` to `127.0.0.1:7001` and returns the app HTML for direct BrowserRouter navigation. `npm run preview` serves the built frontend on `127.0.0.1:4173`; API proxying is a development-server feature, so a standalone preview does not provide backend API access. The backend does not yet serve the built SPA.

The app has three main navigation items: Watchlist (`/`), Stock Research (`/stocks/:symbol`), and Data & Settings (`/settings`). Watchlist reads cached backend data, confirms ticker/company identity before adding, optionally requests history, and persists statuses/tags/notes. Its table, filtering/sorting and ECharts preview use typed APIs; missing valuations remain N/A. See [Watchlist contracts](../docs/WATCHLIST.md). Stock Research connects Overview to cache-only stock/SEC APIs and embedded history. Settings currently calls only `GET /api/ready`. Runtime components contain no mock stocks or finance values.

Stock Research Overview reads cached EOD identity/quotes, price performance, SEC financial metrics/filings, saved scenarios and cited research records. Price & Volume adds daily candles/lines, linked volume, zoom/date navigation, deterministic indicators and saved event/scenario annotations. The persistent header, two tabs and right Drawer retain stock/chart context. AI generation, scenario editing and the detailed report reader remain deferred. See [Overview contracts](../docs/STOCK_OVERVIEW.md) and [Price & Volume formulas and validation](../docs/PRICE_VOLUME.md).

The Vite/React migration removes the old CRA entry, HashRouter routes, login flow, standalone Volume page, Axios/Moment dependency, and React ECharts wrapper. An explicit ECharts core wrapper handles initialization, resize, and disposal. API keys stay in the backend environment file; the frontend uses only same-origin `/api` requests.
