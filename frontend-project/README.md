# Frontend foundation

This app uses React 19, TypeScript 5, Vite 8, Ant Design 6, ECharts 6, React Router 7, and TanStack Query 5. Run with Node.js 24 or a compatible Node.js 22 release.

```bash
npm ci
npm run dev
npm run typecheck
npm run build
npm test
```

The development server listens on `127.0.0.1:5173`. Open `http://localhost:5173/` so browser Origin matches the backend's default `FRONTEND_ORIGIN`. Vite proxies `/api` to `127.0.0.1:7001` and returns the app HTML for direct BrowserRouter navigation. `npm run preview` serves the built frontend on `127.0.0.1:4173`; API proxying is a development-server feature, so a standalone preview does not provide backend API access. The backend does not yet serve the built SPA.

The app has three main navigation items: Watchlist (`/`), Stock Research (`/stocks/:symbol`), and Data & Settings (`/settings`). Stock Research has Overview and Price & Volume tabs; `?history=open` opens the embedded right-side history drawer. The page shell, states, typed API client, query provider, and ECharts lifecycle wrapper are in place. Settings calls only `GET /api/ready`. The Watchlist and Stock Research pages intentionally do not fetch, persist, or display fabricated market data. Stock lookup, watchlist operations, historical bars, research reports, and provider settings are future API integrations.

The Vite/React migration removes the old CRA entry, HashRouter routes, login flow, standalone Volume page, Axios/Moment dependency, and React ECharts wrapper. An explicit ECharts core wrapper handles initialization, resize, and disposal. API keys stay in the backend environment file; the frontend uses only same-origin `/api` requests.
