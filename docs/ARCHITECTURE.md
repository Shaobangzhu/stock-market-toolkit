# Stock Research Lab — Architecture Audit and Baseline

Audit date: 2026-10-11 (America/Los_Angeles). Repository: [Shaobangzhu/stock-market-toolkit](https://github.com/Shaobangzhu/stock-market-toolkit). Audited local HEAD: `429fe6331feedb8b42937035b0abdc07f504c177`; GitHub's default-branch HEAD matched this commit during the audit. The working tree was clean before the documentation additions.

Sections 1–3 describe observed implementation. Sections 4–9 are proposed implementation decisions, not claims that those systems already exist. [Product scope](PRODUCT_SCOPE.md) is authoritative for feature boundaries; [implementation plan](IMPLEMENTATION_PLAN.md) defines delivery gates.

## 1. Actual current architecture

### Runtime, dependencies, and configuration

There are two independent npm projects, with two lockfiles and no root orchestration/workspace configuration. No installed `node_modules` exists in either app root. There is no PostgreSQL client, Prisma schema/migration, Docker Compose file, Vite configuration, test file, or CI workflow in the tracked tree.

| Area | Source and lockfile evidence |
| --- | --- |
| Frontend | React/React DOM **18.3.1**, `react-scripts` **5.0.1**, CRA TypeScript template **1.2.0**, React Router **7.4.0**, Ant Design **5.24.4**, `echarts-for-react` **3.0.2**, ECharts **5.6.0** resolved as a peer, Axios **1.8.4**, Moment **2.30.1**. |
| Frontend TypeScript | TSX files exist, but there is no checked-in frontend `tsconfig.json` or `react-app-env.d.ts`. TypeScript **4.9.5** is lockfile-resolved rather than directly declared. CRA's TypeScript peer range is `^3.2.1 || ^4`. Imports explicitly ending in `.tsx` need attention when moving to deliberate type checking. |
| Backend | Express **4.21.2** with incompatible-major `@types/express` **5.0.0**; TypeScript **5.7.3**; Axios **1.8.3** resolved from `^1.7.9`; dotenv **17.2.0**; cookie-session **2.1.0**; body-parser; reflect-metadata; nodemon/concurrently. |
| Dependency placement | Backend runtime Express, body-parser, cookie-session, and reflect-metadata are in `devDependencies`, so a production-only install is incomplete. Frontend UI/network/router dependencies are also marked development-only; builds need them. Direct imports of `@ant-design/icons` and use of ECharts rely on transitive/peer resolution rather than explicit declarations. |
| Build | Backend emits ES5/CommonJS into `build/` with legacy decorators and metadata. `dev` runs `tsc` then concurrent watch/start scripts. There is no backend `start`, one-shot `build`, test, or lint script. Frontend uses CRA start/build/test/eject, with a dev proxy to `http://localhost:7001`; no runnable test cases are present. |
| Environment | Backend calls `dotenv.config()` after importing its controllers. The intraday utility captures `ALPHA_VANTAGE_API_KEY` at module load, before `.env` initialization; the price singleton reads it later. `.env.example` lists Tiingo/Twelve Data/SEC/OpenAI/PostgreSQL, but source uses none of those integrations and omits its actual Alpha Vantage key requirement. `HOST`, `PORT`, and `FRONTEND_ORIGIN` are not honored. |
| Host tooling | Read-only checks observed Node **24.19.0**, npm **11.17.0**, Docker CLI **29.8.1**, Compose **v5.5.1**. Docker daemon connection failed even after an authorized read-only check outside the socket sandbox; running containers and existing PostgreSQL readiness were not verified. |

Both lockfiles were parsed: 179 backend and 1,413 frontend package-map entries, including each root entry. Frontend metadata includes numerous deprecated CRA-era dependencies. These counts are dependency inventory, not a vulnerability count.

### Routes and UI actually implemented

The frontend uses `HashRouter`; its effective URLs are `/#/`, `/#/login`, and `/#/volume`. Source components are the evidence for implemented behavior:

| UI | Actual behavior |
| --- | --- |
| Home | Checks login, reads saved stock prices, and draws a multi-series line chart. Buttons fetch data and log out. There is no editable watchlist. |
| Login | A password-only form. No email, account creation, user storage, or password reset. |
| Volume | Checks login, reads saved bars, selects a date, and plots volume plus closing price. Title hardcodes Figma; there is no stock route parameter or navigation link from Home to this view. |

Both charts display existing JSON; clicking “Get Data” does not reload component data. Initial network failures can leave `loaded` false and render an indefinitely blank page. Home series omit missing observations rather than inserting nulls, so partial fetches can misalign prices with the shared timestamp axis. Volume takes the first object key rather than explicitly choosing the latest trading date. Styling is sparse, with broad `.buttons` selectors and no shared application shell, route error state, or embedded research interface.

`assets/screenshot.jpg` resembles the implemented Home chart. The other assets illustrate account screens, a table watchlist, and stock detail/chip distribution that are absent from the source. They are legacy design references, not proof of working functionality. Public HTML/manifest still use Money Piranha/Daytrade-Framework branding.

The controller imports register routes as side effects through reflect-metadata decorators and a global Express Router:

| Method | Current endpoint | Behavior |
| --- | --- | --- |
| GET | `/api/isLogin` | Read signed-cookie login flag. |
| POST | `/api/login` | Compare password to a hardcoded value; set cookie login flag. |
| GET | `/api/logout` | Clear login flag. |
| GET | `/api/getData` | Login-gated; begin quote fetch/file write without awaiting completion; immediately report success. |
| GET | `/api/showData` | Login-gated; synchronous JSON-file read. |
| GET | `/api/getSingleStockVolume` | Login-gated; await intraday fetch and file write. |
| GET | `/api/showSingleStockVolume` | Login-gated; synchronous JSON-file read. |

All business failures return a JSON `success` flag with HTTP 200. There is only URL-encoded body parsing, no shared runtime validation, central asynchronous error handling, or health endpoint. No CORS or Host/Origin enforcement is configured. The server listens on port 7001 without a loopback host argument.

### Fetching and storage

`StockPriceFetcher` requests Alpha Vantage `GLOBAL_QUOTE` concurrently for four source-hardcoded symbols. The stored `company_name` is actually the ticker. It stores only a numeric price, keyed under a process-start timestamp (`TIME_TAG`), so multiple refreshes in one process overwrite the same snapshot key. Provider quote dates and market timezone are discarded. Fetch failures become null entries, potentially saving partial or empty snapshots. The caller does not await the fetch, and the fetcher does not await its async-declared save method; write failures can become unhandled rejections.

`singleStockHourlyVolumeFetcher` requests Alpha Vantage intraday data at **30-minute** intervals despite its “hourly” name. The current symbol is hardcoded as FIG; a comment still says OPEN. It appends `Z` to provider timestamps without consulting exchange timezone metadata, discards the symbol/provider identity, and merges whole-day arrays into one JSON object. Changing the configured symbol can contaminate an existing symbol-less file. Parsing failure warns and then overwrites existing content.

Both utilities use synchronous whole-file reads/writes without transactions, atomic replacement, schema validation, retention bounds, or durable operation status. Requests have no explicit timeout/retry/rate-limit policy, and raw Axios errors can include credential-bearing request URLs. Multiple processes and interrupted writes are unsafe; a single process still blocks during filesystem operations.

`prices.json` contains 35 timestamp groups and 140 quote entries. `volume.json` contains one date, 2025-07-31, with 13 OHLCV entries. These files were parsed for structural audit only. None of this data is a source for the new database.

## 2. Prioritized architectural problems

Priority describes remediation order; confirmed findings are distinguished from conditional exploitability or untested compatibility.

| ID / priority | Finding and evidence | Consequence / planned response |
| --- | --- | --- |
| A01 / urgent | `backend-project/build/constants.js:4` contains a literal credential-looking API key. This obsolete file is tracked even though build output is now ignored. It is not imported by the current entrypoint. | Treat as exposed until its owner verifies/revokes it. Do not reproduce or test the value. Removing a file later does not remove Git history. Rotation is an external follow-up, not performed in this audit. |
| A02 / high | `src/index.ts:20,32` has a hardcoded signing key and an unrestricted host bind; `login-controller.ts:35` has a hardcoded password. | Cookie flags can be forged by someone who knows the committed signing key. The cookie is signed, not encrypted, despite the code comment. Remove the entire login/session design during implementation; establish loopback and browser-request boundaries first. |
| A03 / high | Refresh and logout are GET mutations; there is no explicit Origin/CSRF defense or fetch throttling. | Cross-site requests, repeated navigation, and retries can trigger side effects or consume quotas. CORS alone would not prevent writes. Replace with validated POST/DELETE operations and request-origin checks. |
| A04 / high | A quote refresh returns success before completion and does not reliably catch write failures (`stock-data-controller.ts:34`, `stockPriceFetcher.ts:52`). | UI success is not evidence of persistence. Use a persisted operation state and surface failure before reporting completion. |
| A05 / high | Process-lifetime timestamps, timezone guessing, hardcoded symbols, and provider/symbol-free volume storage. | History and comparisons are unreliable. Replace storage rather than migrate it; retain explicit identities, dates, and provenance. |
| A06 / high | Tracked `build/controller/stock-data-controller.js` requires `build/utils/singleStockHourlyVolumeFetcher.js`, which is absent. Several build files have no source equivalent. | The checked-in build cannot run unchanged even if dependencies are present. Compilation may generate the missing file but does not clean obsolete output. Stop tracking generated output and build reproducibly in a later phase. |
| A07 / high | `.env.example` is aspirational; early environment capture can leave intraday requests with an undefined key. No environment validation. | Loading the example does not create the documented system. Initialize and validate backend config before constructing adapters. |
| A08 / high | Locked Axios versions fall in an upstream affected range for [CVE-2025-58754](https://github.com/axios/axios/security/advisories/GHSA-4hjh-wcwx-xvwj). | The cited issue concerns Node handling of attacker-controlled `data:` URLs; current fixed HTTPS requests do not establish an exploitable route. This is confirmed dependency exposure, not a reproduced exploit. Perform a full advisory audit when rebuilding the dependency graph. |
| A09 / medium | Express 4 runtime/Express 5 types mismatch; undeclared frontend TS config; `.tsx` imports; CRA TS4 range; runtime dependency placement. | A clean install/typecheck/build is not demonstrated. Replace CRA and align runtimes, types, peer dependencies, and module settings together. |
| A10 / medium | The decorator registrar uses `for...in` over class prototypes (`decorator/controller.ts:17`). | ES5 lowering makes methods enumerable; native modern class methods are not. Simply changing the TS target can silently remove routes. Replace the registrar before modernization. |
| A11 / medium | Whole-file synchronous storage, parse-error overwrite, missing response schemas, unbounded external calls, and raw error logging. | Data loss, blocked requests, quota exhaustion, and key leakage into logs. Introduce transactions, typed adapters, limits, and redaction. |
| A12 / medium | No source tests, DB constraints, CI checks, root scripts, or pinned runtime. UI error/refresh/alignment flaws. | No established regression or reproducibility baseline. Add focused checks at the corresponding implementation phases. |
| A13 / medium | README advertises registration/watchlist/detail features absent from code, wrong clone directory, backend `start` script that does not exist, and backend directory for frontend setup. Root license is MIT while backend package metadata says ISC. | Treat the README as historical until rewritten; reconcile setup, branding, and license metadata later. |

A01–A03 are real local threat-surface issues, not reasons to introduce accounts or cloud infrastructure. Full Git-history secret scanning, live exploit tests, npm advisory enumeration, installed dependency verification, and runtime UI/build tests were not performed. The audit does not certify the old application as secure or runnable.

## 3. What can be retained

Retain the repository, two app-root directories, TypeScript, Express, Ant Design, ECharts, and useful UI concepts. Rewrite routing, application shell, provider adapters, config, persistence, and request/error handling. Retire Alpha Vantage, JSON persistence, auth/session routes, custom decorators, CRA, and obsolete compiled examples in implementation phases. Do not preserve undocumented old API compatibility; the frontend and backend are one local product and can change together. Nothing is deleted in this audit.

## 4. Target architecture and technical decisions

Use a small modular monolith: a React SPA, one Express backend process, and local PostgreSQL in the existing Docker installation. No microservices, Redis, external queue service, or cloud resources.

```text
Browser: React 19 / Ant Design / ECharts
  | same-origin /api/v1 requests
  v
Express: request validation -> application services -> Prisma repositories
  |                             |                         |
  |                             +-> local job runner      v
  |                                 + provider adapters  PostgreSQL
  |                                       |
  + serves built Vite assets              +-> Tiingo / Twelve Data
                                          +-> SEC EDGAR
                                          +-> OpenAI Responses API
```

In development, Vite on `127.0.0.1:5173` proxies `/api` to Express on `127.0.0.1:7001`. For a normal local run, Express serves built static assets and API from one loopback origin. SPA fallback applies only to HTML navigation after API/static matching: unknown API routes return JSON 404, never `index.html`. Use BrowserRouter and verify deep-link refresh behavior. Do not bind Vite or Express to `0.0.0.0`.

Keep `frontend-project/` and `backend-project/`. Proposed internal organization:

```text
frontend-project/src/
  app/                  router, layout, providers, route error states
  features/watchlist/
  features/stocks/      overview, price-volume, embedded research history
  features/settings/
  api/                  typed HTTP client and query lifecycle
  components/           shared Ant Design and ECharts wrappers
backend-project/src/
  app.ts                testable Express construction, no listen side effect
  server.ts             validated config, startup/shutdown, loopback listener
  config/
  http/                 routes, schemas, errors, Host/Origin enforcement
  modules/              watchlist, stocks, market-data, filings, research, analysis, settings
  providers/            tiingo, twelve-data, sec, openai adapters
  jobs/                 bounded local runner and recovery
  db/                   Prisma client and persistence helpers
backend-project/prisma/ schema and schema-only migrations
```

Controllers translate HTTP; services implement workflows; repositories own persistence; adapters normalize external APIs. The frontend never imports Prisma types or accesses providers directly. Publish browser-safe DTO/schema contracts from a small shared package only if needed; do not add a general monorepo framework just for this.

**Compatibility baseline:** React 19; TypeScript 5.x at a version supported by the chosen tooling; modern Vite; Express 5 with matching types; Ant Design 6 with matching icons; ECharts via an explicit dependency. Prefer a small ECharts lifecycle wrapper (`init`, resize, update, dispose) over carrying an unverified old React wrapper. Pin exact tested package versions in implementation. Node 24 is the candidate runtime because it is present locally and supported by current Prisma requirements. Select and pin a supported PostgreSQL image major and a Prisma major together after a local compatibility check; do not assume old Prisma snippets apply to newer config/client adapters. No package versions were changed here.

[React has deprecated CRA](https://react.dev/blog/2025/02/14/sunsetting-create-react-app). [Vite documents its Node requirements](https://vite.dev/guide/), and [Prisma documents Node 24 and TypeScript 5.4+ support](https://www.prisma.io/docs/orm/v7/reference/system-requirements). [Ant Design 6 supports React 19 without the v5 compatibility patch and requires matching icons](https://ant.design/docs/react/migration-v6/). These references inform the proposed matrix; they do not replace a clean build and UI smoke test.

## 5. Proposed HTTP API boundaries

Namespace new endpoints under `/api/v1`. Symbols are canonical URL identifiers for the initial US-equity scope; use opaque database IDs internally and provider-specific symbol mappings. Trim/normalize input, preserve share-class meaning, reject ambiguity rather than guess, and URL-encode symbols. Unknown stored instruments return 404; opening a URL must not create an instrument or import data.

| Method / path (under `/api/v1`) | Responsibility / result |
| --- | --- |
| GET `/health` | Liveness; no writes and no credential values. |
| GET `/ready` | Database/schema readiness; 503 if unavailable; no writes. |
| GET `/symbols/search?q=...` | Bounded provider lookup, no database insertion. Only user-submitted searches trigger lookup; in-memory debounce/cache is allowed. Return identity and coverage candidates. |
| GET `/watchlist` | Ordered user-added entries with stored latest-close/freshness summaries; empty list initially. |
| POST `/watchlist` | Validate selected symbol/exchange/provider identity; atomically create/reuse instrument/mapping and membership. No implicit price/SEC/research job. 201 for a new membership, 200 if already present. |
| PATCH `/watchlist/:entryId` | Update validated ordering/notes if included in the UI. |
| DELETE `/watchlist/:entryId` | Delete membership only, 204; retain data/reports. |
| GET `/stocks/:symbol` | Stored identity and overview availability; no live provider fetch. |
| GET `/stocks/:symbol/bars?from=...&to=...&provider=...&basis=...` | Sorted daily bars and metadata, bounded range; one provider and basis per response. Empty data is different from unknown instrument. |
| POST `/stocks/:symbol/market-data/refresh` | Explicit `{from,to,provider}` request; create/deduplicate an import job; return 202 with job ID. |
| GET `/stocks/:symbol/filings` | Stored filings, cursor pagination and supported form/date filters. |
| GET `/stocks/:symbol/fundamentals?asOf=...` | Normalized facts/metrics with period, units, accession, cutoff, and missing-data reasons. |
| POST `/stocks/:symbol/filings/refresh` | Explicit SEC submissions/companyfacts job, 202. |
| POST `/stocks/:symbol/research` | Explicit bounded research request with Idempotency-Key; capture inputs/cutoff and queue a run, 202. Never silently refresh inputs. |
| GET `/stocks/:symbol/research` | Paginated history metadata for the embedded stock section. |
| GET `/stocks/:symbol/research/:reportId` | Immutable report, inputs, analysis references, citations; verify report belongs to requested stock. |
| POST `/stocks/:symbol/entry-analyses` | Validate approved method and assumptions, compute deterministically, persist versioned input/output snapshot; 201, or 422 for insufficient data. Block implementation until methodology is specified. |
| GET `/stocks/:symbol/entry-analyses` | Stored entry-price scenarios/results, newest first, paginated. |
| GET `/jobs/:jobId` | Status, progress, safe error, and result IDs. |
| GET `/jobs?symbol=...&kind=...` | Bounded operational history for settings/stock status; not a Research Library. |
| GET `/settings` | Effective nonsecret configuration, override origins, and configured/not-configured provider flags. No startup insert. |
| PATCH `/settings` | Save allowlisted nonsecret preferences only; reject key/database URL/host edits. |
| POST `/providers/:provider/test` | Explicit, bounded connectivity test; may consume quota; return safe capability/status information. |

API reads do not persist domain data or start jobs. Symbol search is a deliberate external read, not an import. Limit search length, symbol length, date span, payload size, pagination, job concurrency, and research token/tool budget. Settings provider selection is allowlisted; clients never supply arbitrary provider base URLs.

Use `{data, meta?}` for success and `{error:{code,message,details?,requestId}}` for failure. Apply real statuses: 400 invalid input, 403 rejected origin/host policy, 404 unknown entity, 409 conflicting/idempotency mismatch, 422 insufficient or unsupported data, 429 local quota limit, 502 upstream failure, 503 unavailable DB/provider configuration, 504 timeout. Async failures appear on the job; 202 means accepted, not completed. Return Decimal/BigInt as JSON strings; convert only chart display values to bounded finite numbers. Include currency, provider, trading date, retrieval time, adjustment basis, and coverage in relevant metadata.

## 6. Proposed database model

Use PostgreSQL with Prisma and reviewed SQL migrations for constraints that need SQL. UUID primary keys, foreign keys, explicit indexes, UTC `timestamptz` for instants, and `date` for daily exchange trading dates. Use fixed-precision Decimal for prices/fundamentals/calculations and BigInt for raw share volume; adjusted volume may be fractional and requires Decimal. Precision/scale must be chosen against provider fixtures before migration approval.

| Entity | Key fields and relationships | Constraints / lifecycle |
| --- | --- | --- |
| `Issuer` | `id`, normalized/padded `cik`, legal name, retrieval timestamp. One issuer may have several share-class instruments. | Unique CIK when known. Created only during explicit resolution/import; missing SEC coverage does not require a fake issuer. |
| `Instrument` | `id`, canonical `symbol`, exchange/MIC, name, currency, exchange timezone, nullable `issuerId`, created/updated timestamps. | Unique canonical symbol within the initial supported US routing universe; reject conflicting listing identity. Expand URL identity before supporting ambiguous multi-market symbols. |
| `ProviderSymbol` | `instrumentId`, provider enum, provider symbol/exchange, validation timestamp. | Unique instrument/provider and unique provider/symbol/exchange identity. No provider seed table. |
| `WatchlistEntry` | `id`, `instrumentId`, sort order, optional user notes, added timestamp. | Unique instrument membership. No user ID or Watchlist container row. Deleting membership never cascades to instrument history. |
| `MarketBar` | `instrumentId`, provider, interval (`1d` initially), trading date, raw OHLCV, nullable adjusted OHLCV, adjustment-method identifier, currency, split factor/dividend if supplied, fetched timestamp, revision/content hash, `importJobId`. | Unique instrument/provider/interval/date; upsert corrections transactionally. Validate nonnegative volume and coherent OHLC bounds. Do not fill missing adjusted fields with raw values. |
| `Filing` | `issuerId`, accession, form, filing date, accepted timestamp if available, report period, primary document URL, fetched timestamp, `importJobId`. | Unique accession. Keep amendments as separate filings. Nullable acceptance timestamps must not imply historical availability. |
| `FundamentalFact` | `issuerId`, accession/filing reference, taxonomy/concept, unit, start/end period (start nullable for instants), value, fiscal year/period, frame/context identity if present, filed/accepted dates, fetched timestamp, normalized identity hash, `importJobId`. | Unique normalized observation hash including issuer/accession/concept/unit/period/context. Preserve restatements; do not deduplicate solely by year or label. |
| `Job` | kind, optional instrument, status, sanitized request spec, idempotency key/body hash, input snapshot when needed, progress, timestamps, attempt/error info, result reference. | `queued -> running -> succeeded/failed/interrupted`; at most one active equivalent import/research job. Transactional claim and bounded worker concurrency. |
| `ResearchReport` | `instrumentId`, unique `jobId`, immutable title/body/structured sections, generated timestamp, cutoff, model, prompt/schema version, exact normalized input snapshot/hash, optional `entryAnalysisId`, response ID and usage metadata. | Insert only after output validation; preserve completed history. JSON snapshots are stored in PostgreSQL, not legacy JSON files. No user/account association. |
| `ResearchSource` | `reportId`, URL, title, publisher if known, published date if known, retrieval time, citation location/ID, source type, optional filing link. | Report-scoped provenance, indexed by report; validate safe links. Do not invent publication dates or store whole third-party articles by default. |
| `EntryAnalysis` | `instrumentId`, method/version, assumptions, data cutoff, immutable normalized inputs/hash, result ranges/metrics, currency/basis, created timestamp. | Reproducible deterministic output; explicit user targets distinguishable from calculated values. No initial or synthetic scenarios. |
| `Setting` | allowlisted key, validated nonsecret value, schema version, updated timestamp. | Key primary key; sparse overrides written only on explicit save. Defaults do not create rows. |

Index market bars by instrument/provider/date, filings/facts by issuer/period/availability, reports and analyses by instrument/created time, jobs by status/created time. Restrict deletion of instruments/issuers referenced by research; a future purge feature must make its scope explicit. Cascading report-to-source deletion is acceptable only within an explicit report deletion workflow, which is not part of the initial API.

Report and analysis snapshots preserve the values actually used, because future provider corrections can update bars and restated facts. No promise of full point-in-time historical market backtesting is made. Research using a cutoff must exclude filings accepted after that cutoff and label uncertain availability; a current adjusted-price history may include adjustments learned later. Deterministic fundamental selection must distinguish instant vs duration, quarterly vs annual/TTM, fiscal calendars, units, and amendments. Do not sum overlapping periods or silently combine taxonomies.

**Initialization:** use a new dedicated database/volume. Every application table above remains empty after schema migration, startup, and first-page reads. No seed data, reference-table inserts, automatic jobs, migration of legacy files, or ticker-universe preload. Prisma migration metadata is the sole infrastructure-bookkeeping exception. Schema-only migrations are allowed and required; legacy-data migrations are prohibited.

## 7. Provider and analysis boundaries

**MarketDataProvider:** capabilities, identity resolution, and daily-bar retrieval return normalized DTOs and typed failures. Tiingo is the default; Twelve Data is an explicit alternative. Initial behavior does not auto-fail over. An alternative import requires user selection and records its provider. A chart/query selects a single provider series; gaps remain visible. Never splice providers to make a chart look complete. Tiingo documents both raw and split/dividend-adjusted prices and subsequent corrections, which is why refreshes must support revisions. [Tiingo EOD documentation](https://www.tiingo.com/documentation/end-of-day).

Store raw and adjusted values separately. Raw prices describe historical traded prices; adjusted series support comparable trend/return calculations. Entry-price comparisons require a documented, consistent basis and current-share interpretation. Do not assert equivalence between Twelve Data's adjustments and Tiingo's before fixture-based verification. Twelve Data's documentation pages could not be retrieved reliably during this audit; current endpoints, coverage, adjustment semantics, and account entitlements remain an explicit integration gate.

**SEC adapter:** backend-only access to submissions/companyfacts and allowlisted filing documents; identify the client with a real contact-bearing User-Agent. Use a shared conservative 2 requests/second limiter, caching, bounded retries and backoff. SEC documents a maximum of 10 requests/second and does not support browser CORS on `data.sec.gov`. [SEC access guidance](https://www.sec.gov/about/webmaster-frequently-asked-questions), [EDGAR APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces). Resolve issuer CIK on demand; do not preload a symbol catalog into the database. Required filing forms and normalized metric mappings remain to be selected.

**ResearchProvider:** backend-only OpenAI Responses API. Use a configurable, account-supported model; `.env.example` names `gpt-5-mini`, but its access, suitability, and tool support were not tested and are not a locked decision. News runs need retrieved evidence, using supported web search rather than model memory alone. Preserve citation annotations and display clickable sources. Use `store: false` for response application state and retain report history locally; this is not a zero-retention guarantee for all provider processing. [Responses migration guidance](https://developers.openai.com/api/docs/guides/migrate-to-responses), [web search and citations](https://developers.openai.com/api/docs/guides/tools-web-search).

Validate structured report output, handle refusal/incomplete output, and capture usage/model/prompt version. Send only the selected stock, bounded public evidence, and necessary analysis inputs; do not send credentials, environment files, unrelated notes, or local filesystem contents. Treat news/filings as untrusted evidence, not instructions. The model receives no arbitrary shell, filesystem, SQL, trade, or generic URL-fetch tool. If web-search and structured-output capabilities need separate requests for the chosen model, specify and budget that workflow before coding.

**Analysis service:** deterministic calculations over validated stored inputs. OpenAI may explain results but cannot invent/overwrite price bars, SEC facts, or numeric outputs. Do not implement an entry formula until methodology, units, lookback, adjustment basis, minimum coverage, and expected examples are approved in the scope.

## 8. Jobs, failure handling, and local operations

Use a persisted PostgreSQL job record and an in-process bounded runner. Polling is sufficient for UI progress; no WebSocket/SSE requirement initially. Job creation and deduplication are transactional. Store a unique idempotency key plus request hash; a repeated key returns the existing operation, while a changed body returns 409. Persist and validate import results atomically per bounded batch; do not claim the whole interval succeeded when coverage failed. Record gaps, partial results, and provider error codes distinctly.

On restart, mark abandoned running jobs interrupted. Read-only imports can be manually retried idempotently. Do not blindly replay an OpenAI request after an ambiguous timeout/process crash: it may already have incurred cost. Keep that state visible and require a fresh explicit retry. Report persistence and job completion should commit together. Bound connection/request time, response size, retry count, concurrency, date ranges, and model budgets; respect provider rate-limit responses. No scheduled/background market refresh on first boot.

Compose will run PostgreSQL only, with a dedicated named volume and a loopback-published port (5437 is the existing example's candidate, not a verified free port). Node apps run on the host initially. Pin the database image; validate health and schema separately. Do not install another Docker runtime or touch unrelated containers/volumes. Use a dedicated database role and local credentials; application single-user scope does not prohibit database service credentials.

Keep secrets in an ignored backend environment file. Validate config before imports/adapters execute; distinguish optional unavailable provider keys from invalid required local/database config. Settings expose presence/status, never values or connection strings. Logs include request/job ID, duration, provider, and safe error codes; redact headers, query keys, database URLs, and raw Axios/SDK request objects. Implement graceful shutdown and DB disconnect. Define a local `pg_dump`/restore procedure and test restoration into a separate disposable database before relying on it.

## 9. Local security boundaries

- Bind Express, Vite, and published PostgreSQL ports to loopback only. Explicitly allow required Host values and exact browser origins in development and local serving. Handle proxy-origin behavior deliberately.
- Browser mutation requests require allowed Origin, JSON content type, and a custom application request header. Reject cross-site Fetch Metadata where supplied, unexpected/missing browser-origin proof, and wildcard CORS. No GET mutations. These are local request defenses, not users or login sessions.
- Validate all symbol/query/body/provider output schemas. Parameterize database operations through Prisma; raw SQL only for reviewed schema or necessary parameterized queries.
- Provider endpoints are adapter-owned HTTPS allowlists. No arbitrary URL proxy; validate redirects as well. Safely render model text/Markdown and links; never inject untrusted HTML into chart tooltips or render external filings in an unsandboxed application context.
- Restrict body sizes, job admission, request budgets, retries, and connection-test volume. Do not expose secrets through browser environment prefixes or localStorage.
- Loopback/origin controls do not defend against malware or other trusted local processes; the product assumes a trusted personal OS account. Remote or multi-user access would require a new architecture decision, not a quiet configuration toggle.

## 10. Exact inspection inventory and limits

All **66 tracked paths** at the audited commit were inventoried. **57 text/JSON/source files** were read or programmatically parsed; **6 images** were visually inspected; **3 binary metadata/icon files** were inventoried only. Lockfiles were parsed for dependency graph, versions, engines, peers, and deprecation metadata, not manually read line by line. Legacy data was parsed without modification. Compiled JavaScript was read and its relative import targets checked statically; it was not executed.

### Root, configuration, documentation, and data — read/parsed

```text
.gitignore
LICENSE
README.md
backend-project/.env.example
backend-project/package.json
backend-project/package-lock.json
backend-project/tsconfig.json
backend-project/data/prices.json
backend-project/data/volume.json
frontend-project/.gitignore
frontend-project/package.json
frontend-project/package-lock.json
frontend-project/public/index.html
frontend-project/public/manifest.json
frontend-project/public/robots.txt
```

### Backend TypeScript — read

```text
backend-project/src/index.ts
backend-project/src/router.ts
backend-project/src/controller/index.ts
backend-project/src/controller/login-controller.ts
backend-project/src/controller/stock-data-controller.ts
backend-project/src/decorator/controller.ts
backend-project/src/decorator/index.ts
backend-project/src/decorator/request.ts
backend-project/src/decorator/use.ts
backend-project/src/enums/methods.ts
backend-project/src/interfaces/request-with-body.ts
backend-project/src/utils/constants.ts
backend-project/src/utils/singleStockHourlyVolumeFetcher.ts
backend-project/src/utils/stockPriceFetcher.ts
backend-project/src/utils/util.ts
```

### Frontend source and styles — read

```text
frontend-project/src/index.tsx
frontend-project/src/App.tsx
frontend-project/src/Views/Home/index.tsx
frontend-project/src/Views/Home/style.css
frontend-project/src/Views/Login/index.tsx
frontend-project/src/Views/Login/style.css
frontend-project/src/Views/Volume/index.tsx
frontend-project/src/Views/Volume/style.css
```

### Tracked compiled output — read/static import audit

```text
backend-project/build/constants.js
backend-project/build/index.js
backend-project/build/router.js
backend-project/build/controller/LoginController.js
backend-project/build/controller/covered-call-controller.js
backend-project/build/controller/decorator.js
backend-project/build/controller/index.js
backend-project/build/controller/login-controller.js
backend-project/build/controller/stock-data-controller.js
backend-project/build/decorator/controller.js
backend-project/build/decorator/index.js
backend-project/build/decorator/methods.js
backend-project/build/decorator/request.js
backend-project/build/decorator/use.js
backend-project/build/enums/methods.js
backend-project/build/interfaces/request-with-body.js
backend-project/build/utils/constants.js
backend-project/build/utils/stockPriceFetcher.js
backend-project/build/utils/util.js
```

### Image assets — visually inspected

```text
assets/dashboard.png
assets/login.png
assets/money_piranha_logo_design.png
assets/screenshot.jpg
assets/sign_up.png
assets/stock_detail.png
```

### Inventoried only — not content-audited

```text
.DS_Store
backend-project/.DS_Store
frontend-project/public/favicon.ico
```

No existing root/nested `AGENTS.md` or applicable ancestor `AGENTS.md` was found. The OpenAI Docs skill was read for provider documentation verification; it is external tooling guidance, not repository source. Git status, HEAD/remotes, tracked-file inventory, host tool versions, and Docker connectivity were inspected. No private local credential file was opened. No package installation, application build/start, live market/API call, database creation, data migration, provider credential test, or production source change was performed. Existing UI was audited through source/styles and committed images, not a running browser session. Current official sources are linked beside the decisions they support; account entitlements and exact future package compatibility remain unverified.
