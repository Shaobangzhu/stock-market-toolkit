# Stock Research Lab — Product Scope

Baseline date: 2026-10-11 (America/Los_Angeles).

This document defines the intended product, not the current implementation. The source audit and proposed technical design are in [ARCHITECTURE.md](ARCHITECTURE.md); delivery gates and unresolved choices are in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md). This phase changes documentation only.

## Purpose and operating model

Stock Research Lab is a personal tool for stock research and entry-price intelligence. It helps one person maintain a watchlist, examine historical price and volume, review corporate filings and fundamentals, and retain evidence-backed qualitative research and entry-price scenarios.

The application and database run locally on the user's computer. Single-user means no application accounts, login, sessions, ownership columns, or authorization roles. Outbound HTTPS requests to the selected data providers are expected: local-only does not mean offline or that information sent to a provider stays on the computer. Existing saved research and market data remain readable without provider connectivity.

Research supports human judgment. It does not submit orders, connect to a broker, manage a portfolio, or promise returns. Numeric calculations must be reproducible from identified inputs; model-generated commentary must be distinguishable from observed data and deterministic calculations.

## Required navigation

| Location | Purpose and required behavior |
| --- | --- |
| `/` | **Watchlist**, the default home. Show only user-added stocks. Add, remove, and open a stock; display the latest stored closing price, currency, observation date, data source, and freshness when available. |
| `/stocks/:symbol` | **Stock Research**, with **Overview** selected by default. Show company identity, data availability, filings/fundamentals, research actions, and entry-price context. |
| `/stocks/:symbol?tab=price-volume` | **Price & Volume** within Stock Research. Display aligned historical OHLCV charts, date range, provider, adjustment basis, and gaps. |
| Within Stock Research | **Research History**, embedded in the stock page. Selecting a saved report opens an Ant Design Drawer on the right; closing it preserves the stock, selected tab, and chart state. It is not a separate navigation destination. |
| `/settings` | **Data & Settings**. Show connection/configuration status, nonsecret preferences, available coverage, refresh/job results, and local data-management guidance. |

Use ordinary browser paths, not hash routing. A direct load or refresh of a stock URL must work. Unknown symbols, invalid tab values, and unavailable reports need explicit states; unknown tabs fall back to Overview. Drawer selection can remain component state in the first release; shareable report-selection URLs are not required.

## Functional baseline

### Watchlist and identity

- A single personal watchlist, without a separate Watchlist owner or account entity.
- Search/resolve a symbol through configured providers; distinguish symbol, exchange, company/issuer, and provider-specific identifiers. Search results do not seed the database.
- Explicitly adding a stock persists its identity and watchlist entry. Adding does not silently buy data, import history, or generate research.
- Removing an entry removes only watchlist membership. Preserve its downloaded data and research; add it again to access it through the Watchlist. Saved direct stock links continue to work.
- Initial market scope is proposed as US-listed equities with end-of-day data in the listing currency. Confirm coverage and symbol rules before provider implementation. Intraday, streaming, and multi-market ticker ambiguity are deferred.

### Historical price, volume, and entry-price intelligence

- Tiingo is the sole market-price provider for the MVP, supplying historical daily OHLCV, adjusted prices and corporate actions where supported. Historical observations persist in PostgreSQL; cached records remain available during temporary outages. Failed requests must not overwrite valid cached data; show stale/unavailable states honestly. No automatic fallback provider is configured. Additional providers require a future scope decision and are outside the MVP.
- Use daily bars initially. Latest daily close must be labeled as such, never presented as a live executable quote.
- Support user-requested refreshes with progress and failure states. Keep prior successful data readable on failure.
- Preserve raw and adjusted data and their provenance. Never compare values from different currencies or adjustment bases without an explicit conversion/method.
- Entry-price scenarios identify their method, assumptions, input dates, data completeness, and calculation version. User-entered targets must be labeled as user assumptions. An unavailable calculation returns “insufficient data,” not a fabricated estimate.
- The actual entry-price methodology, horizons, indicators, valuation inputs, and presentation require a product decision before implementation. Do not infer a trading strategy from the old covered-call example or “chip distribution” image.

### Filings, fundamentals, and qualitative research

- SEC EDGAR is the source for supported company filings and reported fundamentals. Keep accession numbers, reporting periods, filing/acceptance dates, units, and source URLs.
- Missing SEC coverage is a normal state; do not equate missing data with zero revenue, earnings, or debt.
- OpenAI Responses API supports user-triggered news research and qualitative analysis. It may summarize selected SEC evidence and obtain current news using a supported web-search capability.
- Save completed reports per stock with timestamps, model/prompt version, source citations, input snapshot, data cutoff, and limitations. New runs create new reports rather than overwrite past reports.
- Separate model opinions from sourced facts. Render citations visibly and safely in both report content and the right-side Drawer.
- Failed, interrupted, or incomplete runs must not appear as completed reports. Repeated clicks must not inadvertently create multiple paid runs.

### Data & Settings

- Show whether backend-only provider credentials are configured, without returning their values. Edit secrets in the ignored local environment file initially; the UI does not store keys in browser storage or write environment files.
- Persist nonsecret preference overrides only when the user saves them. Defaults come from code/environment and need no database rows.
- Show exactly three external providers: Tiingo (prices/synchronization), SEC EDGAR (filings/fundamentals, companyfacts/submissions), and OpenAI (news discovery, bullish/bearish qualitative analysis and research reports). Expose data freshness, refresh history/status, and actionable connection errors. Connection tests are explicit actions.
- Status concepts are Online, Not Configured, Rate Limited, Error, and Unknown. Configuration presence alone does not prove Online. Derive provider counts from actual configured or verified status records; never hardcode an Online count.
- Provide local backup/restore instructions before routine use. Destructive reset/purge tools are not required for the first release and must never run automatically.

## Fresh database is mandatory

1. Create a new, dedicated PostgreSQL database and Docker volume for this application. Do not repurpose an existing database or volume.
2. Every application table starts empty, including instruments, issuers, watchlist entries, provider mappings, bars, filings, fundamentals, jobs, reports, sources, entry scenarios, and settings.
3. Do not migrate, import, convert, backfill, or bootstrap from `backend-project/data/prices.json`, `backend-project/data/volume.json`, or any other legacy stock data.
4. Do not preload ticker universes, predefined stocks, demo watchlists, sample reports, provider lookup rows, or a singleton settings row. Represent fixed provider names as code constants/enums.
5. Schema migrations may create schema objects only. Prisma's migration bookkeeping is infrastructure metadata, not application data; it may contain migration records. No domain-data seed command runs during installation, migration, startup, or tests against the application database.
6. First launch, page loads, health checks, and settings reads must leave all application tables empty. Persist data only as the result of an explicit user action.
7. Test fixtures belong exclusively in isolated, disposable test databases or mocked responses. They must never be copied into the personal application database.

Legacy JSON files remain untouched in this audit. Their future removal from the active application is code cleanup, not data migration.

## Explicit exclusions

- Dashboard, including a renamed or secondary dashboard home.
- Standalone Research Library or global research-library route.
- Register, Sign In, Sign Out, password reset, sessions, users, accounts, roles, and tenancy.
- Brokerage integrations, portfolio synchronization, trade execution, automated trading, and strategy execution engines.
- Cloud deployment, cloud databases, hosted queues, cloud infrastructure, public ingress, and remote access.
- Automatic legacy-data migration, starter stock lists, and seeded research content.

## Acceptance conditions for the first usable release

- Fresh schema and first boot contain zero application rows and show useful empty states on `/` and `/settings`.
- A user can add a valid stock, explicitly fetch daily history, inspect data provenance, and remove the watchlist entry without losing saved research.
- Overview and Price & Volume work through direct URLs and browser back/forward navigation; there are no authentication or excluded navigation items.
- Provider errors, partial coverage, missing credentials, database outages, and stale data have distinct states. Loading failures do not leave a blank page.
- SEC facts retain their reporting context; research reports retain evidence and open in the embedded right-side Drawer.
- Entry-price outputs use an approved, tested method and visibly disclose missing inputs and assumptions.
- Application services and PostgreSQL listen only on loopback; secrets never appear in browser bundles, API responses, logs, or committed files.
