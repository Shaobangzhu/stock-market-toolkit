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

The app has three main navigation items: Watchlist (`/`), Stock Research (`/stocks/:symbol`), and Data & Settings (`/settings`). Watchlist now reads real cached backend data, confirms ticker/company search before adding, optionally requests history, and persists manual statuses/tags/notes. Its table, filters/sorting and selected-stock ECharts preview use typed APIs; missing valuations remain N/A. See [Watchlist contracts](../docs/WATCHLIST.md). This machine uses `http://127.0.0.1:5173` with the ignored backend Origin configured to match. Stock Research still has Overview/Price & Volume shells and embedded history; full business wiring/research generation remain future work. Settings currently calls only `GET /api/ready`. No mock stocks or finance values are embedded in runtime components.

The Vite/React migration removes the old CRA entry, HashRouter routes, login flow, standalone Volume page, Axios/Moment dependency, and React ECharts wrapper. An explicit ECharts core wrapper handles initialization, resize, and disposal. API keys stay in the backend environment file; the frontend uses only same-origin `/api` requests.
