# Stock Research Lab

Stock Research Lab is a local-only, single-user stock research project. The default home is a complete Watchlist workspace with confirmed adds, optional imports, persistent status/tags/notes, filtering and cached previews. Stock Research Overview reads price performance, SEC fundamentals/filings, saved scenarios and embedded research history. Price & Volume provides daily candles/lines, linked volume, deterministic indicators, date navigation and saved event/entry annotations. PostgreSQL/Prisma persists explicit Tiingo/SEC synchronization. AI generation, detailed report reading and approved entry-price methods remain later phases. Opening the app creates no stock records or provider jobs.

## Run locally

Use Node.js 24 (or a supported Node.js 22 release) and the existing local Docker installation. Follow [database setup](docs/DATABASE.md) to configure the ignored backend environment files and start only the dedicated `srl-postgres` container. On this machine its PostgreSQL port is `127.0.0.1:5437`; inspect availability before using that port elsewhere. Do not commit `backend-project/.env` or database credentials.

In separate terminals:

```bash
cd backend-project
npm ci
npm run db:migrate
npm run build
npm start
```

```bash
cd frontend-project
npm ci
npm run dev
```

Open the exact URL configured as `FRONTEND_ORIGIN`: the template default is [http://localhost:5173/](http://localhost:5173/), and this machine currently uses [http://127.0.0.1:5173/](http://127.0.0.1:5173/). Vite binds to loopback and proxies `/api` to Express at `127.0.0.1:7001`. Keep one explicit local frontend origin in the ignored backend `.env`; do not widen the whitelist. Backend liveness is `/api/health`; database readiness is `/api/ready`.

The frontend uses BrowserRouter with Vite's SPA fallback. Direct navigation works at `/`, `/stocks/:symbol`, `/stocks/:symbol?tab=price-volume`, `/stocks/:symbol?history=open`, and `/settings`. Entering a symbol reads its stored research workspace; unknown stocks show a not-found state without saving/importing anything. See the [frontend foundation](frontend-project/README.md) for scripts and current UI boundaries.

## Project guidance

The MVP has exactly three external providers: **Tiingo** for daily market prices and synchronization, **SEC EDGAR** for official filings and financial fundamentals, and **OpenAI** for news discovery and qualitative research. Tiingo is the sole price provider. Prices are cached in PostgreSQL and remain readable during outages; failures preserve valid records and report stale/unavailable data. There is no automatic market-data fallback. Additional providers are outside the MVP. See the implementation plan's **Prompt 05 - Documentation & Environment Cleanup** milestone.

- [Product scope](docs/PRODUCT_SCOPE.md) and [architecture](docs/ARCHITECTURE.md)
- [Implementation plan](docs/IMPLEMENTATION_PLAN.md)
- [Backend API and configuration](backend-project/README.md)
- [Database setup, migrations, and backup](docs/DATABASE.md)
- [Tiingo endpoints, synchronization, and coverage](docs/TIINGO.md)
- [SEC filings, fundamentals, point-in-time rules, and valuation limits](docs/SEC_EDGAR.md)
- [Watchlist workflow, APIs, saved-scenario contracts, and validation](docs/WATCHLIST.md)
- [Stock Research Overview, financial display policies, and validation](docs/STOCK_OVERVIEW.md)
- [Price & Volume controls, indicator formulas, event provenance, and validation](docs/PRICE_VOLUME.md)

The `assets/` screenshots document the former prototype and are not current product screens. No sign-in, account, trading, or cloud deployment is part of this application.
