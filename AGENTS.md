# Stock Research Lab

- Read `docs/PRODUCT_SCOPE.md`, `docs/ARCHITECTURE.md`, and `docs/IMPLEMENTATION_PLAN.md` before implementation. They describe the target; the current README and screenshot assets are legacy references, not requirements.
- Keep the product local-only and single-user. No cloud infrastructure, brokerage integration, portfolio syncing, or trade execution/automated trading.
- Navigation: Watchlist `/` is home; Stock Research `/stocks/:symbol` defaults to Overview, with Price & Volume at `?tab=price-volume`; Research History stays embedded with a right-side Drawer; Data & Settings is `/settings`.
- Do not add Dashboard, standalone Research Library, registration, sign-in/out, sessions, users, accounts, roles, or tenancy.
- Target stack: React 19 + TypeScript + Vite, Ant Design + ECharts; Express + TypeScript; PostgreSQL + Prisma using the existing local Docker installation.
- Keep `frontend-project/` and `backend-project/` as the app roots. TypeScript source is authoritative; never edit generated `backend-project/build/` files as a fix.
- Start with a new database: every application table must initially be empty. Never migrate `prices.json`, `volume.json`, or other legacy stock data. No predefined stocks, ticker preload, sample watchlist, reports, or startup/seed inserts. Keep test fixtures isolated from the personal database.
- Providers: Tiingo primary history, Twelve Data alternative, SEC EDGAR filings/fundamentals, OpenAI Responses API news/qualitative research. Provider access and secrets stay in the backend; never use client environment variables or browser storage for keys.
- Bind local services to loopback and enforce allowed Host/Origin boundaries. Do not replace removed login with another account system.
- Use explicit user actions for persistent imports and paid research. GET/read/startup paths must not create domain data or launch jobs. Never silently mix providers, currencies, adjustment bases, or timezones.
- Preserve data provenance and report input snapshots/citations. Keep deterministic numeric analysis separate from model commentary; do not invent an entry-price formula or treat generated text as market data.
- Validate external inputs/responses, redact credentials, use bounded requests, and report meaningful HTTP/job failures. Never copy credential values from legacy files into documentation or code.
- For implementation changes, run the relevant type/build and behavior checks once tooling exists; report checks that could not run. Documentation-only tasks must not install packages or change application behavior.
