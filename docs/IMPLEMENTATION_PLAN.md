# Stock Research Lab — Implementation Plan

Baseline date: 2026-10-11 (America/Los_Angeles). Based on the audited commit and evidence in [ARCHITECTURE.md](ARCHITECTURE.md). Product constraints are in [PRODUCT_SCOPE.md](PRODUCT_SCOPE.md) and root [AGENTS.md](../AGENTS.md).

This plan authorizes no implementation by itself. The current phase creates those four documents only. No application code, dependencies, lockfiles, legacy data, services, or database state is changed. Later implementation prompts should name a phase and satisfy its exit gate before moving on.

**Progress:** the backend-only Phase 1 refactor is recorded in [PHASE_1_BACKEND.md](PHASE_1_BACKEND.md). PostgreSQL/Prisma foundation is implemented; see [DATABASE.md](DATABASE.md) and [validation record](DATABASE_VALIDATION.md). The frontend uses React 19, Vite, Ant Design, ECharts, BrowserRouter and the required three-item navigation; see [frontend setup](../frontend-project/README.md). [Tiingo backend history and jobs](TIINGO.md) implement explicit first/incremental imports and cached price reads. [SEC filings/fundamentals](SEC_EDGAR.md) implement explicit submissions/companyfacts sync, publication-cutoff reads and conservative deterministic metrics. Watchlist operations, frontend data wiring, OpenAI research, entry-price calculations and built-SPA serving remain future work. Legacy JSON files were deleted without migration or backups as authorized.

## Implementation sequence

### 0. Resolve exposed credentials and confirm local prerequisites

- Have the owner identify and revoke/rotate the credential-looking key found in `backend-project/build/constants.js:4`; do not copy or try the value. No account/key validity was established in the audit.
- Record whether history cleanup is desired after rotation. Do not rewrite Git history automatically. Remove tracked obsolete builds in phase 1, but do not mistake deletion for credential revocation.
- Confirm/start the existing Docker daemon when implementing. CLI/Compose are installed, but the audit could not connect to the daemon. Inspect existing containers, volumes, ports, and CPU architecture before provisioning anything.
- Select a dedicated new database/volume name and an available loopback port. The example's port 5437 is only a candidate. Never reuse, clear, or repurpose an unrelated database/volume.

**Exit gate:** credential exposure has an owner/action status; Docker daemon is accessible; a new isolated application database destination is chosen. External credential rotation may require the owner's provider account access and must not be claimed complete without evidence.

### 1. Establish a reproducible local application skeleton

- Keep the `frontend-project/` and `backend-project/` roots. Replace CRA with Vite and React 19; add explicit frontend TypeScript configuration, React types, HTML entry, scripts, and intentional import conventions.
- Replace decorator side-effect registration with explicit Express routes before raising the ES5 target. Separate testable application construction from server startup; use Express 5 and matching types.
- Add validated configuration loaded before adapter construction. Honor loopback host/port settings. Remove old login/session/Alpha Vantage routes and dependencies when their replacement skeleton is ready; do not create an authentication compatibility layer.
- Establish `/api/v1/health`, structured errors, input/body limits, exact Host/Origin policy, and Vite `/api` proxy. Set up normal local serving of built assets and BrowserRouter deep-link fallback without swallowing API 404s.
- Select a tested Node 24 / TypeScript / Vite / React 19 / Ant Design 6 / ECharts / Express / Prisma combination; verify Prisma's module/config/adapter requirements for the selected major. Use direct dependencies for directly imported runtime libraries and matching React/Express/icon types.
- Add scripts for development, typecheck, one-shot build, tests, and local start. Small root orchestration is sufficient; avoid introducing an elaborate monorepo system.
- Stop tracking generated backend builds and obsolete compiled-only examples; ensure clean builds remove stale files. Leave legacy JSON unimported. Update ignore coverage for secrets, local DB backups, generated output, and OS metadata. Reconcile README setup/branding and package license metadata when implementation lands.

**Exit gate:** a clean install from committed lockfiles succeeds in the implementation phase; frontend/backend typecheck and build; local health endpoint works; all required empty routes load directly; invalid API routes return JSON 404. No login, Dashboard, standalone Research Library, provider calls, or startup data writes. Verify Ant Design notifications/Drawer and ECharts mount/resize/dispose under React StrictMode. Confirm services bind to loopback.

### 2. Create the empty PostgreSQL/Prisma foundation

- Use the existing Docker installation with a pinned PostgreSQL image, dedicated named volume, loopback-only port, local credentials, and health check. No cloud infrastructure or extra container platform.
- Implement the entity model and constraints incrementally, starting with instrument identity, watchlist, and sparse settings. Add market-data/jobs and research entities with their owning phases if that keeps migrations reviewable. Every migration is schema-only.
- Configure Prisma with deliberate Decimal/BigInt/date serialization and required SQL constraints/indexes. Use infrastructure migration metadata only; no application seed command, reference rows, or singleton settings insert.
- Add readiness reporting and graceful database lifecycle. Read settings defaults from validated environment/code until explicitly saved.
- Establish an isolated disposable test database. Test safety must verify the test destination before destructive cleanup; never point test reset logic at the personal application database.

**Exit gate:** migrate a brand-new volume/database, start the application, visit `/` and `/settings`, and verify an explicit row count of **zero in every application table**. Migration metadata is excluded from that count. Repeat after restart. Confirm no code path reads/imports `prices.json` or `volume.json`, and no automatic seed/ticker preload/provider sync runs. DB outage returns 503/readiness failure with an actionable UI state.

### 3. Deliver Watchlist and the required navigation

- Build the Ant Design shell with only Watchlist and Data & Settings as top-level destinations. Stock Research is reached from a selected stock and has Overview/Price & Volume tabs plus embedded Research History.
- Implement symbol resolution through a bounded provider adapter. Resolve initial US-equity identity and share-class formatting explicitly; searches do not persist results. Do not ship a stock catalog or examples as application data.
- Implement watchlist add/read/remove and stored stock identity endpoints. Add only user-selected identities. Reject duplicates/ambiguous matches and preserve historical data on membership removal.
- Implement empty/loading/error/not-found states, browser back/forward navigation, and tab query parsing. History remains empty until real user-generated reports exist.

**Exit gate:** first-run empty experience is complete; mocked-provider tests cover valid/invalid/ambiguous symbols and duplicate adds; explicit add persists only identity/membership, not bars or reports. Removing membership preserves existing associated data. Direct stock URLs and the Price & Volume query behave as specified. No excluded UI/route appears.

### 4. Add reliable Tiingo history, jobs, and Price & Volume

- Implement the local persisted job runner, transactional claim/deduplication, timeouts, quotas, redacted errors, and interruption handling before creating imports.
- Implement Tiingo identity/history normalization and explicit date-range refresh. Store daily raw/adjusted OHLCV, currency/timezone, provenance, split/dividend fields where supplied, and retrieval/revision metadata.
- Build aligned price/volume charts from one provider/basis; sort dates explicitly, preserve gaps, and label latest daily close and data freshness. Requery after job completion.
- Support overlapping imports and revised provider bars through deterministic upserts. Never convert missing data to zero or claim partial history is complete.
- Tiingo is the sole market-price provider. Keep persisted PostgreSQL prices readable during outages, preserve valid records on failed requests, and report stale/unavailable data. No automatic fallback provider is configured.

**Exit gate:** adapter fixtures verify normalization, provider error bodies, 429/backoff, missing dates, invalid OHLCV, and adjustments; database tests verify idempotent overlap/revisions and atomic writes; UI covers pending/failed/interrupted/success states and post-refresh updates. Optional live checks use the user's own configured key and a user-selected stock, with no demo/seed stock. Failed requests preserve the cached Tiingo series.

### Prompt 05 - Documentation & Environment Cleanup

This prompt milestone follows the Tiingo backend implementation. Prompt numbering is separate from the original architecture phases below; later prompt numbers and phase headings remain unchanged.

- Align scope, architecture, setup and settings specifications around exactly three MVP providers: Tiingo for market prices, SEC EDGAR for filings/fundamentals and OpenAI for news/qualitative research.
- Remove obsolete market-provider credentials and selection settings from the tracked template, ignored local environment and runtime validator. Preserve unrelated settings and credentials in place.
- Retain the MarketDataProvider abstraction; preserve cached PostgreSQL prices on failures and report stale/unavailable data honestly. No market-data fallback or additional provider is part of the MVP.
- Data & Settings derives counts from configured/verified status records, with Online, Not Configured, Rate Limited, Error and Unknown states. Never hardcode an Online count.

**Exit gate:** current MVP documentation and templates contain only the approved providers; environment secrets remain ignored and preserved; configuration/startup and existing Tiingo regression checks pass. No provider feature, Docker or database changes.

### 5. Add SEC filings and contextual fundamentals

**Backend implemented:** see [SEC_EDGAR.md](SEC_EDGAR.md) for endpoints, selected US-GAAP/DEI concepts, annual/quarterly/YTD separation, amendment/cutoff rules, derived FCF/margins and conservative annual valuation. Existing schema is reused without seeds. Frontend integration, issuer-specific fiscal-calendar policies, TTM and broader concept/IFRS coverage remain future work.

- Resolve issuer CIK and share-class relationships on demand. Fetch submissions/companyfacts through the backend with a real contact User-Agent and shared conservative rate limit.
- Decide supported filing forms and metrics before normalization. Store accession, period/unit/concept, accepted/filed dates, source URLs, and amendments/restatements.
- Implement deterministic fact selection, missing/unsupported coverage states, pagination, and explicit refresh jobs. Handle instant vs duration facts, fiscal calendars, and overlapping periods.

**Exit gate:** fixtures cover share classes, missing CIK, amendments, different fiscal calendars, missing acceptance timestamps, units, and cutoff filtering. Ratios and TTM values are omitted with reasons until their definitions are approved. UI links to the supporting filing. No browser-to-SEC fetch and no startup issuer/ticker preload.

### 6. Implement approved entry-price analysis

- First resolve decision U03 below. Write the method specification and hand-checkable expected cases before implementation.
- Implement pure deterministic calculations over normalized persisted data, with explicit lookback, basis, units, assumptions, rounding, and minimum-data rules.
- Persist immutable `EntryAnalysis` inputs, method version, cutoff, and results. Distinguish user targets from computed results. Do not infer numeric targets from an LLM narrative or the legacy covered-call script.

**Exit gate:** independently calculated examples agree; insufficient/stale/contradictory data produces a clear unavailable result; future source updates do not change saved analyses. The UI explains the inputs and method sufficiently to review the result.

### 7. Add Responses API research and embedded history

- Resolve model, web-search/output capabilities, report structure, date horizon, and spend limits before coding. Treat the existing example model as a candidate only.
- Implement bounded user-triggered research jobs over explicit input snapshots. Use OpenAI Responses API; retrieve news evidence with supported search; preserve returned citations and usage metadata; request `store: false`.
- Validate generated output and refusal/incomplete cases. Save report, citations, and job success atomically. Do not blindly replay ambiguous paid requests after a crash or timeout.
- Implement stock-scoped history and the right-side Ant Design Drawer. Preserve tab/chart state on open/close; show evidence, generated time, data cutoff, and limitations. Sanitize rendering and safe external links.
- If entry-price methodology is still unresolved, sourced qualitative research can proceed using already validated market/SEC inputs, but the product is not complete until phase 6 passes. Do not fabricate entry prices to fill the gap.

**Exit gate:** mocked Responses tests cover citations, schema failure, refusal, timeout, duplicate-click/idempotency behavior, and interrupted runs. Completed reports remain unchanged after later imports. No standalone library route exists. A bounded live test is optional and requires an explicitly selected stock and configured account; no sample report is seeded.

### 8. Finish Data & Settings and local reliability

- Complete effective preferences, masked configuration status, explicit connection tests, data coverage/freshness, and job diagnostics. Secrets stay in the backend environment file.
- Document local startup/shutdown, ports, upgrades, database backups/restoration, and provider quota behavior. Validate restore into a separate disposable database; do not overwrite personal data.
- Verify restart recovery, read-only offline access, graceful shutdown, safe logs, local Host/Origin defenses, and exclusion of secrets from bundles. Review the resolved dependency graph with a current advisory audit; prioritize reachable production risks as well as development-server exposure.
- Run the focused end-to-end acceptance path and all relevant existing checks. Optional CI can run tests/builds if requested later; do not add deployment/cloud infrastructure.

**Exit gate:** new empty initialization, explicit add/import/research, direct navigation, retained history, provider failure, restart, and restored-copy workflows pass. No unexpected outbound calls occur on first launch; no application rows appear without user actions. Record exact installed versions and the checks actually run.

## Decisions future prompts must resolve

These are bounded uncertainties, not permission to expand the product beyond the requested scope.

| ID | Decision / evidence needed | Default proposal and blocking point |
| --- | --- | --- |
| U01 | Supported markets, instrument types, currency scope, duplicate symbols, renamed/delisted stocks. | US-listed equities, daily bars, listing currency; canonical symbol unique in this initial universe. Confirm before symbol/schema/provider work; multi-market support requires revisiting the route identity. |
| U02 | Tiingo account coverage, request quotas, permitted storage, adjustment semantics, and desired date range. | Tiingo is the sole MVP price provider, with no automatic fallback. Existing verified defaults and application coverage limits are recorded in TIINGO.md; live account entitlements remain unverified. |
| U03 | Meaning of “entry-price intelligence”: valuation vs price-based method, formula, lookback, scenarios, user inputs, rounding, missing-data rules, and expected examples. | Do not invent a method. Blocks calculated entry prices in phase 6, not the empty shell/watchlist/history foundation. No backtesting or automated strategy execution implied. |
| U04 | SEC forms, metric definitions, quarterly/annual/TTM selection, restatement/cutoff policy, and foreign-issuer support. | Start with selected US-company annual/quarterly filings, preserve original contexts. Confirm exact forms/concepts and cutoff behavior before phase 5 calculations. |
| U05 | OpenAI model and account tool access, research horizon/template, maximum cost/token/tool budget, and whether user notes may be sent. | Responses API, cited news plus qualitative analysis, public selected evidence only, `store: false`; no automatic paid runs. Blocks phase 7 provider wiring. Existing `gpt-5-mini` example is not a verified selection. |
| U06 | Exact Node/npm/TS/Vite/Ant Design/ECharts/Express/Prisma/PostgreSQL versions and module settings. | Candidate Node 24, React 19, Ant Design 6, Express 5; confirm all peers, Prisma config/adapter, database image, and clean build in phases 1–2. |
| U07 | Docker daemon availability, free ports, existing volumes, dedicated DB/role/volume naming, valid SEC contact. | Existing Docker only; loopback ports 5173/7001 and candidate 5437. Inspect before provisioning; never reset an existing volume. |
| U08 | Research/data retention, deletion/export UI, backup destination and cadence. | Keep completed reports locally; watchlist removal retains data; manual documented backup/restore first. No automatic purge, reset, cloud backup, or scheduled jobs. Resolve retention before adding such controls. |
| U09 | Exposed legacy key ownership/validity, revocation status, and whether repository-history cleanup is needed. | Treat as exposed; owner revokes if applicable. No credential test, rotation, or history rewrite was performed. |

## Highest implementation risks

| Risk | Control |
| --- | --- |
| Fresh-database rule weakened by convenience defaults, test fixtures, ticker sync, or settings inserts. | Count every application table after migrations, startup, page reads, and restart; schema migrations contain no domain inserts. |
| Runtime modernization silently drops routes or leaves stale compiled code. | Replace decorators first; clean reproducible output and route smoke tests; remove tracked build artifacts in phase 1. |
| Provider adjustments, currencies, dates, and restated fundamentals yield plausible but wrong analysis. | Normalize with fixtures, retain provenance/context, enforce one series basis, snapshot inputs, and test independently calculated examples. |
| Duplicate paid work or incorrect success after timeouts/crashes. | Durable job status, transactional idempotency, explicit retries for ambiguous paid calls, no premature success. |
| Local-only is mistaken for inherently secure or offline. | Loopback + Host/Origin defenses, secret isolation/redaction, bounded provider requests, and clear outbound-data boundaries. |
| Scope grows toward dashboard/accounts/trading or cloud services. | Review each phase against Product Scope and root AGENTS; excluded features are not placeholders to implement later. |

## Audit verification record

Completed: clean initial Git status; local/remote HEAD match; all tracked paths inventoried; application source/config/styles read; lockfiles/data parsed; committed UI images inspected; compiled import existence checked; current official framework/provider references reviewed; host CLI versions checked; read-only Docker daemon check attempted.

Not run: dependency installation, build/typecheck/test scripts (dependencies are absent), application startup/browser smoke test, full npm advisory scan, full Git-history secret audit, provider calls/credential validation, database/Compose startup, schema migration, or data migration. Docker daemon remained unreachable. These are explicitly assigned to implementation gates rather than claimed as passing.

Documentation delivery verification: inventory paths/counts and internal links checked; Markdown whitespace checked; final tracked-file diff confirms the original source, dependencies, lockfiles, data, assets, and configuration are unchanged. Only `AGENTS.md`, `docs/PRODUCT_SCOPE.md`, `docs/ARCHITECTURE.md`, and `docs/IMPLEMENTATION_PLAN.md` are added.
