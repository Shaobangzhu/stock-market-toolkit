# Stock Research Lab backend

Use Node 24 and npm (`.node-version` selects 24); Node 22.12+ is also supported. From `backend-project/`:

```sh
npm ci
npm run build
npm test
npm start
```

`npm run dev` watches TypeScript with tsx. `npm run typecheck` checks source without emitting files. Builds clean this package's `dist/` first; output is ignored and must not be committed.

Configuration lives in this directory: `.env.example` is the tracked template; `.env` holds local secrets and is ignored. If `.env` is absent, copy the template without replacing an existing file. Startup also works without `.env` or optional keys. Existing process environment values override `.env`; the loader uses this package's path even when invoked from another working directory. Runtime environment reads stay in the config module; the Prisma CLI config uses the same database URL validator after quiet dotenv loading. Invalid configuration prints field names only and exits with code 1.

Default address is `http://127.0.0.1:7001`. `HOST` must be `127.0.0.1`; `PORT` must be 1–65535. `FRONTEND_ORIGIN` defaults to `http://localhost:5173` and must be an exact local HTTP origin with no trailing slash/path. Only that configured frontend origin receives CORS headers. Browser requests from the exact backend origin are also accepted for future locally served UI. Proxy trust is disabled; any future Vite proxy must preserve the frontend Origin and send the backend Host (for example `changeOrigin: true`).

Supported fields: `NODE_ENV`, `HOST`, `PORT`, `FRONTEND_ORIGIN`, `DATABASE_URL`, `TIINGO_API_KEY`, `TIINGO_MAX_REQUESTS_PER_HOUR`, `TIINGO_MAX_REQUESTS_PER_DAY`, `TIINGO_MAX_SYMBOLS_PER_MONTH`, `TIINGO_MAX_BYTES_PER_MONTH`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `SEC_EDGAR_USER_AGENT`, `SEC_EDGAR_MAX_RPS`. Blank optional keys/database URL/User-Agent mean unconfigured. A provided database URL must target local PostgreSQL. Tiingo is the sole MVP market-price provider; there is no primary/fallback selector or automatic fallback. SEC EDGAR supplies filings/fundamentals and OpenAI supplies news/qualitative research. PostgreSQL prices remain readable during outages; failed requests preserve valid cache and expose stale/unavailable status. SEC rate must be an integer 1–10; a provided User-Agent must contain a contact email and no control characters. The SEC adapter additionally rejects known placeholder contact addresses.

## API and local request protection

Stock Research adds cache-only Overview and completed-history endpoints. See [Stock Research Overview](../docs/STOCK_OVERVIEW.md) for request limits, price statistics, SEC valuation comparability and deferred capabilities. These endpoints reuse existing storage without schema migration or provider calls on reads.

[Valuation & Entry Intelligence](../docs/VALUATION.md) adds cache-only source/history reads plus explicit Calculate and Save endpoints under `/api/stocks/:symbol/valuation`. Deterministic Decimal P/E, P/S and user fair-value scenarios retain immutable inputs, outputs and formula versions in the existing `EntryScenario` table; no migration or seeds are needed.

`GET /api/health` returns HTTP 200:

```json
{"data":{"status":"ok","application":"Stock Research Lab"}}
```

This is liveness only: it does not check PostgreSQL/provider availability, expose configuration, or write data. It accepts no query parameters or body. HEAD is supported; other non-OPTIONS methods return 405 after the local write checks. Unknown endpoints return 404. Authentication and legacy JSON-data endpoints are removed. Implemented endpoints use `/api`; see [Tiingo](../docs/TIINGO.md), [SEC EDGAR](../docs/SEC_EDGAR.md), [Watchlist](../docs/WATCHLIST.md) and [Stock Research Overview](../docs/STOCK_OVERVIEW.md). Settings business APIs remain a later phase.

All future POST/PUT/PATCH/DELETE requests must include:

```http
Origin: http://localhost:5173
Content-Type: application/json
X-Stock-Research-Lab: 1
```

Origin must match configured frontend or exact backend origin; missing/null/unapproved origins are rejected. Host must match `127.0.0.1:<PORT>` or `localhost:<PORT>`. Cross-site Fetch Metadata is rejected. A read-only curl health request does not need an Origin or custom header. CORS preflights allow only the documented methods and headers. There are no cookies, credentials, login sessions, or authorization roles. These controls assume a trusted local OS account.

JSON and URL-encoded parsers are Express built-ins with a 32 KiB limit and no compressed request bodies. URL-encoded parsing is available for deliberate future read/utility integrations, but state-changing API requests require JSON. Request schemas use Zod and place parsed data in `response.locals.validated`; do not assign Express 5's query getter. Factory `createApp(config, {router, logger, database})` enables composed routes and isolated HTTP tests without binding on import.

Errors use `{error:{code,message,requestId}}`, with 400 validation/malformed input, 403 local-access rejection, 404 unknown endpoint, 405 wrong method, 413 oversized body, 415 unsupported encoding/content type, 500 unexpected failure, or 503 database unavailability. Public messages are safe constants. Logs contain operational metadata, never raw error/config/request objects, request URLs/bodies, stack traces, or API key values. Startup uses validated config, handles listen failures safely, and closes on SIGINT/SIGTERM with a bounded deadline.

The database foundation, Tiingo daily history and SEC EDGAR filings/fundamentals are implemented, with cache-only reads and explicit sync jobs. See [Tiingo API and limits](../docs/TIINGO.md) and [SEC API, financial definitions and point-in-time limitations](../docs/SEC_EDGAR.md). SEC requires a real contact User-Agent, no API key. No seeds or legacy data migration exist. HTTP tests use ephemeral listeners; database fixtures run only in isolated test databases. The React 19/Vite frontend shell currently calls only the readiness API from Data & Settings; chart/watchlist/fundamentals API wiring remains future work.

## PostgreSQL foundation

The complete [Watchlist workspace](../docs/WATCHLIST.md) adds cache reads, protected explicit search/resolve/add/edit/remove APIs and optional Tiingo history sync. Membership is separate from retained instrument annotations; price/research inputs are read from existing persisted entities. Apply the schema-only third migration before starting the updated backend. No seeds or provider calls run at startup.

See [database operations and schema contracts](../docs/DATABASE.md). Use `npm run db:migrate` before startup and `npm run db:status` to inspect migration state. `GET /api/ready` checks database readiness; `/api/health` remains liveness. `npm run test:integration` runs against a newly created isolated test database. No startup seed/import runs. Database credentials remain in ignored local environment files.
