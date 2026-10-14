# Stock Research Overview

`/stocks/:symbol` is the cached single-stock research workspace. Exactly two tabs remain: Overview (default) and [Price & Volume](PRICE_VOLUME.md) (`?tab=price-volume`). History stays embedded at the bottom and opens the right Drawer (`?history=open`), which also accepts chart research markers while retaining Price & Volume. The detailed report reader remains a later phase.

## API and lifecycle

| Endpoint | Behavior |
| --- | --- |
| `GET /api/stocks/:symbol/overview?range=1Y` | Stored identity, membership, EOD quote/change/freshness, price statistics, saved scenario projection, company availability, five completed research records and saved cited qualitative evidence. Range: `1M`, `3M`, `6M`, `1Y`, `3Y`, `5Y`, `MAX`; default `1Y`. Optional `exchange`. |
| `GET /api/stocks/:symbol/research?limit=5` | Completed stock-scoped record metadata. Default five, maximum fifty; a bounded latest-record view. Optional `exchange`. |
| `GET /api/stocks/:symbol/fundamentals?limit=40` | Existing cached SEC metrics and reporting context. Overview selects the latest annual duration and separately labels the balance-sheet date. |
| `GET /api/stocks/:symbol/filings?limit=5` | Existing cached official filing links and publication/report dates. |
| `POST /api/stocks/:symbol/sync` | Existing explicitly confirmed Tiingo import. First import requests provider-available history; subsequent refresh defaults to the seven-day overlap. Full backfill is optional, bounded to fifty years. |
| `POST /api/stocks/:symbol/fundamentals/sync` | Optional, separately selected SEC sync in the confirmation dialog. |

Reads create no instrument, membership, provider request, job, report or settings row. Unknown stored stocks return 404; invalid inputs 400; ambiguous listings 409; unavailable storage a safe 503. Browser requests stay under local `/api`. Price/SEC admission failures are independent; one admitted job is not rolled back when the other admission fails.

Overview reads a repeatable-read PostgreSQL snapshot, bounded to 20,000 observations per price basis, fifty completed reports and bounded scenarios/citations. Removed membership does not prevent retained data reads. Symbol-specific query keys, abort signals and keyed workspace state prevent old ticker panels/Drawer selection from carrying over. The header/chart window persist across tab/Drawer changes. Active jobs poll and failed refreshes retain the last successful cache. An expired job heartbeat permits explicit retry, without startup replay.

## Financial display policy

- Header: latest stored **RAW EOD close**, trading date, Tiingo source and stale/cached status. No Live label. Daily change and 52-week range reuse the conservative Watchlist projection.
- Windows anchor to the latest stored trading date; calendar month/year subtraction clamps month ends. MAX means all imported history, not all conceivable provider history. Requested/observed dates and partial coverage are returned.
- Performance uses **TOTAL_RETURN** only when every selected RAW trading observation has a matching adjusted record. Otherwise the whole window uses labeled RAW prices. Missing adjusted points never receive raw values.
- Period change compares observed endpoints using exact Decimal arithmetic. RAW comparisons require unchanged verified share basis/session continuity. Partial windows disclose observed endpoints.
- Historical volatility: sample standard deviation of daily log returns × √252 × 100; at least twenty verified daily returns. Gaps, unknown share basis or unsupported calendars return N/A. Logarithms use bounded floating-point display calculations; money/persistence remains Decimal. The log-return/252 convention is documented in [CME realized-volatility rules](https://www.cmegroup.com/rulebook/files/S_5582.pdf); this app explicitly chooses the sample estimator/minimum above.
- Verified missing sessions insert null chart breaks. Outside the existing verified 2026 calendar, gaps exceeding four calendar days are conservatively broken without claiming they are missing exchange sessions. Coverage remains unverified.
- Average volume: arithmetic mean of stored **RAW shares** in the selected window, without estimates for omitted days.
- P/E and P/S use backend annual-denominator methods, labeled **not TTM**, with source/report/quote dates. The browser does not recompute them. Negative earnings/incomparable periods stay N/A.
- `valuation.marketCapitalization` adds a Decimal-string metric: RAW close × positive same-date shares for one verified listed class and matching currency. Market cap and P/S reject shares disclosed after the quote date. This strict rule often yields N/A.
- Saved fair value and entry zone reuse scenario provenance. [Valuation & Entry Intelligence](VALUATION.md) now provides the scenario editor, comparison and calculation details. Current margin of safety uses the saved Base Case fair value and latest comparable raw close; planned-entry safety is separately labeled in the comparison. Boundary-relative entry distance keeps its documented sign convention.

## Company, news and history

The current instrument/issuer schema stores name, exchange/currency and SEC identity, but no description, sector, industry or verified company website. Those fields return null and render honest missing states. SEC links use stored CIK and official filing URLs; company websites are not guessed.

AI generation is disabled until its service exists. Existing successful `ResearchRun.output.summary` is rendered as saved text. Optional saved evidence has a validated read contract:

- A `ResearchSource` with `evidenceSnapshot.sourceType = "news"` supplies its actual title, URL and nullable publication date.
- `ResearchRun.output.overviewProjection` may contain `{version: 1, bullishDrivers, bearishRisks, catalysts}`. Each bounded point is `{text, sourceIds}`; every UUID must belong to that report's stored citations. Unsourced/mismatched points are withheld. This does not authorize report generation or converting model text to numeric analysis.
- URLs require HTTPS without embedded credentials. React renders commentary as text, never HTML. Missing sections stay empty.

History now includes completed AI reports, saved entry scenarios and manual thesis/notes. The latest five appear under `<SYMBOL> — Research History`, including saved summaries. The right Drawer reads original prices, assumptions, conclusions and citations, supports tracked-stock/type/date/keyword filtering and same-series previous/current comparisons, and appends immutable manual note revisions. See [Research History](RESEARCH_HISTORY.md) for snapshot rules, pagination and API contracts.

## Verification and isolated preview

```sh
# backend-project
npm run build
node --test --test-reporter=spec test/*.test.mjs
node scripts/test-database.mjs
node scripts/verify-database.mjs --expect-empty

# frontend-project
npm run build
npm test -- --reporter=dot
node ../backend-project/node_modules/tsx/dist/cli.mjs test/overview-preview.mjs
```

The last command starts a **test-only** visual preview on a random loopback port using built assets/isolated fixtures. It has no database/provider access, rejects mutations, closes after fifteen minutes and stops with Ctrl-C. Its fixture module is absent from production bundles.

Validation on October 12, 2026: both builds passed; **80 backend tests**, **32 guarded disposable-database integration tests**, **27 frontend tests** passed. Coverage includes invalid/missing stocks, exact performance calculations, gaps/short samples, annual periods, missing fundamentals/scenarios, provider failures, explicit sync, ticker replacement, two tabs, embedded history/owned citations and ECharts StrictMode disposal.

Browser checks used the isolated preview at default desktop size and 410-pixel width. No horizontal overflow occurred; tab/Drawer flow and global ticker replacement worked. The viewport was restored afterward. The real restarted API returned 404 for an unknown stock and readiness remained healthy. All fifteen personal application tables stayed empty; the existing three migrations remain applied. No package installation, new migration, provider call or `.env` edit was required. Non-blocking warnings remain for Vite's roughly 592 kB main chunk and jsdom's Ant Design CSS/pseudo-element support.
