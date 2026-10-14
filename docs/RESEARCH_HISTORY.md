# Embedded Research History

Research History remains at the bottom of Stock Research Overview, titled `<SYMBOL> — Research History`. It shows five latest saved AI reports, entry scenarios and manual thesis/notes with dates, type, fair-value interval, version and saved summary. `View All` and row selection open the right Drawer using `?history=open`. On Price & Volume, marker selection opens that same Drawer while preserving tab, range, indicators and zoom. There is no standalone library route or navigation item.

## Reads and scope

- `GET /api/stocks/:symbol/research?limit=50&exchange=...` now returns mixed research summaries. Overview embeds the first five. Existing price/chart reads stay cache-only.
- `GET /api/research/history` accepts either `symbol` and optional `exchange`, or `trackedOnly=true`. It supports `search` (ticker/company, saved summary and structured result), `kind=REPORT|SCENARIO|NOTE`, UTC calendar dates `from`/`to` inclusive, `limit=1..50`, and `offset=0..10000`. Filtering occurs before pagination; `nextOffset` indicates another page. All Research means stocks with current Watchlist membership. Local stock history remains accessible after membership removal.
- `GET /api/research/records/:kind/:id` returns original details, source links, version siblings and snapshots. Only successful completed AI reports are visible; failed/running reports are withheld. Associated scenarios must belong to completed reports. Reads respect the current timestamp and stored cutoffs.

Type, instrument and series identify a version lineage. The comparison selector offers earlier versions in that same lineage; it cannot compare unrelated stocks or methods. It shows previous/current research dates, captured price, assumptions, fair-value estimates, entry ranges, saved risks, catalysts, bullish drivers and thesis. Changed values receive a blue border. Monetary values stay exact strings; comparison performs no valuation arithmetic.

The Drawer can search, filter and select another tracked stock's record without replacing the stock header or chart underneath. Selected original details remain open when filters no longer match that record. HTTP/query errors have explicit retry states. Empty history displays instructions to save the first scenario/note; no example reports or tickers are inserted.

## Original inputs and compatibility

`ResearchRun`, `EntryScenario` and `ResearchNote` keep the existing schema and immutable triggers. Reading history never calls a provider, starts research, imports a price, or recalculates a valuation. Saved input/output snapshots provide the historical price and conclusions. Missing fields remain N/A.

- `valuation-v1` scenarios retain `inputSnapshot.price`, assumptions, result cases, Bear–Bull fair-value interval, Base Case entry bounds, original reference-price MOS, planned-entry MOS and method version. The Drawer reads those saved outputs directly.
- AI reports expose their original `inputSnapshot` and `output`; recognized prices use `inputSnapshot.price`, `marketObservation` or `stock.lastPrice`. Recognized risks/catalysts use the existing `output.overviewProjection` fields or explicit saved arrays. Citations come from that report's immutable `ResearchSource` rows. Related scenario assumptions/bounds are shown only if the scenario existed by the report's completion; later scenarios cannot replace its original conclusion. AI report creation remains the future Responses API feature.
- Legacy plain-text notes remain readable with no inferred historical price. Legacy reports with unsupported/absent snapshot fields show N/A alongside the original stored snapshot; they are not backfilled from current market data.
- Source links must be safe public HTTPS URLs and are rendered as ordinary links. Saved analysis and JSON are rendered as escaped text; no raw HTML execution or Markdown HTML is introduced.
- Notes appended after an AI report are labeled with their creation date and “Added after this report.” They remain annotations and do not modify the generated output. Completed research sources and inputs cannot be edited through this feature.

## Manual notes and revisions

`POST /api/stocks/:symbol/notes` accepts `{exchange,title,content,risks,catalysts,seriesId?,expectedVersion?,researchRunId?}`. It requires the established local Origin, JSON and custom-header write protection. Title is 1–160 characters; content 1–12000; risks/catalysts up to ten entries each with at most 1000 characters. Empty or invalid inputs return 400. Unknown stock/completed report is 404; stale revision version is 409 `RESEARCH_CONFLICT`; database failures are 503 with redacted diagnostics.

Explicit saving creates a `ResearchNote` version. `seriesId` and `expectedVersion` together create a revision; an advisory transaction lock serializes concurrent checks. Earlier versions remain immutable, and a revision retains its report association. `content` stores a versioned `research-note-v1` JSON document with title/text, risks/catalysts and an original cached raw Tiingo daily close snapshot (row ID, source hash, revision, date, currency, retrieval time and adjustment basis). A missing quote stays null. No provider call is made to fill it. Quote availability uses the existing conservative daily-date +29-hour policy. Editing scenarios continues to use the established valuation editor and append-only scenario API.

## Chart markers

The backend assigns chronological research ordinals per instrument across saved types: `R1`, `R2`, `R3`, etc. This ordinal differs from the version within a report/scenario/note series, which remains visible in the marker title and Drawer. Filtering does not renumber markers. The current chart loads the latest 50 records; the Drawer pages through older history.

Markers use real completion/creation timestamps converted to the exchange timezone. The existing daily display rule anchors timestamps at/after 16:00 to the next available stored observation, and preserves original event dates in Recent Events. No fake candle or interpolated session is created. Records after available chart history have no candle marker. No saved records means no research markers. Chronological ordinals assume append-only history; manually backdating a record outside the UI can change ordinals, while UUID references still select the same saved record.

## Verification

Backend HTTP tests validate scopes, type/date filters, pagination bounds, UUIDs, protected note writes, conflicts and log redaction. Guarded database tests cover empty reads, mixed five-row previews, tracked-stock filtering, keyword/date/type filtering, pagination, ordinal stability, original report/scenario snapshots, later-scenario exclusion, immutable triggers, concurrent note revisions, legacy missing prices and persistence through separate backend-process reads. Frontend tests cover empty history, cross-stock filters, source links, previous/current comparison, explicit revisions, two-tab navigation, Drawer close state, ECharts marker alignment/click behavior and empty markers.

Commands: backend `npm run build`, `node --test --test-reporter=spec test/*.test.mjs`, `node scripts/test-database.mjs`; frontend `npm run build`, `npm test -- --reporter=dot`. Tests use mocked responses or the guarded disposable database only. No migrations, dependency additions, seeds or cloud/library routes are required.

Validated October 14, 2026: both builds pass; **90 backend tests, 39 isolated PostgreSQL integration tests and 58 frontend tests** pass. Focused chart tests also pass after ordinal integration. The browser verified original details/source links, previous/current thesis comparison and a 410px mobile Drawer with internal table scrolling and no console errors. Quote-revision tests confirm old notes retain their original price while a new note version captures the updated cached quote. Separate backend-process reads preserve stored report snapshots. The local backend returns 200 for health, readiness and empty tracked-stock history. All **15 personal application tables remain empty**, with three existing migrations applied. Existing non-blocking Vite chunk-size/jsdom CSS warnings remain.
