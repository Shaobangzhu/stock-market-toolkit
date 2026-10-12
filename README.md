# Stock Research Lab

Stock Research Lab is a local-only, single-user stock research project. The current implementation has an Express API, an empty PostgreSQL/Prisma database foundation, and a React frontend shell. Market-data imports, watchlist persistence, research generation, and entry-price calculations are later phases; opening the app does not create stock records or run provider jobs.

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

Open [http://localhost:5173/](http://localhost:5173/). The Vite server binds to loopback and proxies `/api` to the Express server at `127.0.0.1:7001`. Use `localhost:5173` in the browser to match the backend's default `FRONTEND_ORIGIN`; if you choose a different local origin, set it explicitly in the ignored backend `.env`. Backend liveness is `/api/health`; database readiness is `/api/ready`.

The frontend uses BrowserRouter with Vite's SPA fallback. Direct navigation works at `/`, `/stocks/:symbol`, `/stocks/:symbol?tab=price-volume`, `/stocks/:symbol?history=open`, and `/settings`. Entering a symbol opens a research shell; it does not resolve, save, or import a stock yet. See the [frontend foundation](frontend-project/README.md) for scripts and current UI boundaries.

## Project guidance

- [Product scope](docs/PRODUCT_SCOPE.md) and [architecture](docs/ARCHITECTURE.md)
- [Implementation plan](docs/IMPLEMENTATION_PLAN.md)
- [Backend API and configuration](backend-project/README.md)
- [Database setup, migrations, and backup](docs/DATABASE.md)

The `assets/` screenshots document the former prototype and are not current product screens. No sign-in, account, trading, or cloud deployment is part of this application.
