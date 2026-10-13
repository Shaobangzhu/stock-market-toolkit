# Watchlist workspace

Implemented 2026-10-12. `/` remains the default home. The approved screenshots guide the navy/blue layout, summary cards, table and selected-stock panel; their symbols, financial examples, extra providers and connection counts are not application data or requirements.

## User workflow

An empty database shows **Your Watchlist Is Empty**, the requested introductory description, zero counts derived from the API and **Add Stock**. Initial page/header reads make only cache queries; they never search providers, save instruments or launch jobs.

Add Stock provides explicit ticker/company-name search and exact-ticker resolution. Select a search result to verify company, exchange and currency before final confirmation. Search results alone persist no instruments/membership. An existing stored listing can be confirmed without provider connectivity. Active duplicates are rejected both in the UI and under transactional database admission.

The optional history checkbox is unchecked. When checked, choose a start date (the displayed default is approximately one year ago); final confirmation adds membership and explicitly submits a Tiingo import. A failed import admission does not undo the successful add. Queued/running/succeeded/failed/interrupted status and safe errors remain visible on the selected stock. Watchlist reads poll every two seconds only while visible entries have active price jobs; they never launch another job. Explicit Import 1Y History/Sync Prices buttons use the existing market-data runner. Refresh Watchlist reloads stored records only.

All eleven requested financial/research columns are present, plus management actions. Selecting a row opens the right-side preview: identity, stored EOD observation, ECharts sparkline, saved valuation/entry data, manual research status, completed report summary, personal notes and links to `/stocks/:symbol` and `/stocks/:symbol?tab=price-volume`. The separate Stock Research page still has its existing shell; full chart/research-page business wiring is future work.

Statuses are Watching, Researching, Waiting for Entry and Archived. Filtering supports symbol/company/tag text, status, custom tag, archived membership and proximity to a saved entry zone. Sorting supports identity, last price, update/research timestamps and absolute distance from entry. Unavailable values sort last. Archived entries are hidden by default unless explicitly selected/included. After an add, the UI includes archived entries so a re-added listing with retained archived status is visible and can be reviewed/reactivated explicitly.

Tags and personal notes save to PostgreSQL through protected writes. Removing a stock deletes only membership and retains instrument, annotations, market data, scenarios and research. Re-adding restores annotations/status. Optimistic revision checks return 409 for stale edits instead of silently overwriting another view.

## API boundaries

All endpoints use `/api`, standard `{data: ...}` / safe error envelopes and the existing local Host/Origin policy. Writes require configured Origin, JSON and `X-Stock-Research-Lab: 1`. No authentication/session/account system exists.

| Endpoint | Contract |
| --- | --- |
| `GET /api/watchlist` | Cache-only workspace projection. Query: `search`, `status` (enum), `tag`, `includeArchived=true\|false`, `nearEntry=true\|false`, `nearPercent` (0–50, default 5), `sort=symbol\|company\|price\|distance\|status\|lastResearch\|lastUpdated`, `direction=asc\|desc`. Returns items, total/filter counts, tag facets, summary and response cutoff. |
| `POST /api/instruments/search` | Body `{query}` (1–100 printable characters). Explicit provider lookup by ticker/name, with matching stored identities when available. Returns at most 20 candidates and a warning if only local matches are available. |
| `POST /api/instruments/resolve` | Body `{symbol}`. Canonicalizes share classes and resolves full supported Tiingo metadata, or uses a stored identity. Returns company/exchange/currency, duplicate flag and an opaque identity confirmation. |
| `POST /api/watchlist` | Body `{resolutionToken, initialSync?: {startDate}}`. Creates instrument if needed, retained annotation record and membership. Returns 201 with entry ID and optional sync job/admission error. It accepts no client-supplied prices, company metadata, valuations or identity overrides. |
| `PATCH /api/watchlist/:id` | Body `{revision, researchStatus?, tags?, notes?}` with at least one changed field. Tags normalize/deduplicate to lowercase, at most ten labels of 32 characters. Notes are bounded to 8,000 characters. Returns the new revision. |
| `DELETE /api/watchlist/:id` | JSON `{}`. Deletes membership only; repeated removal is 404. |

Confirmations expire after ten minutes and backend restart invalidates them. They are per-instrument validation artifacts held in memory, not login sessions, cookies or persistent browser tokens. The workspace is bounded to 250 memberships; fetches use bounded bars/scenario/report projections. Reads use a repeatable-read transaction and sequential queries on its single PostgreSQL connection.

Meaningful failures include invalid requests (400), local-access rejection (403), missing entries/unsupported ticker (404), duplicate/conflicting/expired confirmation (409), unsupported listing/workspace bound (422), rate limits (429), provider errors (502) and unconfigured provider/database failures (503). Existing keys never reach the browser. Personal notes are not sent to Tiingo/SEC/OpenAI.

## Provider search limits

The [official Tiingo search API](https://www.tiingo.com/documentation/utilities/search) supports ticker and name lookup but is explicitly documented as **beta**, with a changeable response contract. The implementation isolates it behind optional `MarketDataProvider.searchInstruments`, validates payloads, limits results to active stock candidates and re-resolves selected metadata. Exact ticker resolution remains available if search changes or account permissions block it. No alternative market provider or seeded directory is introduced.

Search uses the existing token-header transport, serialized requests, timeouts, controlled retries, request/bandwidth budgets and 429 handling. Successful searches cache in memory for ten minutes, with at most 100 cached queries. Search calls use a utility label in local symbol accounting; SEC/Tiingo account-wide usage outside this backend and vendor-specific search accounting remain unobservable, so provider rate errors are authoritative. Provider request-usage records may be written by explicit searches; no domain data is saved until confirmation. No live search/import was used for automated tests.

A search-specific 403 blocks further search attempts in that process without disabling daily/EOD access. A 401 invalid-token response blocks provider access globally. Correcting credentials or permissions requires a backend restart. Exact-ticker resolution does not depend on the beta search endpoint.

## Financial projection policy

- Last Price is the latest stored Tiingo daily RAW close, labeled with its trading/retrieval dates. It is never a live/executable quote.
- Daily Change compares two consecutive verified trading observations with known unchanged share basis. Gaps, missing split fields and split events return N/A rather than a misleading 1D change. The existing verified calendar currently covers 2026 only.
- 52W Range uses stored RAW lows/highs through the last stored EOD date, within a trailing 365-day window. Short coverage is labeled partial. Unknown or changed split basis returns N/A. `stored-window` denotes cached coverage, not a guarantee that every historical holiday/omission is verified.
- Fair value and entry bounds come only from saved `EntryScenario` records. Latest research summaries come only from completed `ResearchRun` output summaries. Missing data displays N/A or Not Researched. User-selected research status is independent of report-generation status.
- Monetary values and geometric entry-distance calculations use Decimal/string values in the backend. The browser converts only for formatting/chart pixels, with no financial persistence or entry-price model.

## Saved-scenario read contract

This phase does not implement or invent an entry-price methodology, scenario creation UI or research generation. Future approved writers may expose a validated read projection under `EntryScenario.resultSnapshot.watchlistProjection`:

```json
{
  "version": 1,
  "adjustmentMode": "RAW",
  "referenceTradingDate": "YYYY-MM-DD",
  "fairValueLow": "decimal string, optional",
  "fairValueHigh": "decimal string, optional"
}
```

Entry bounds use the existing `lowerPrice`, `upperPrice` and `currency` columns. Saved bounds with unknown basis remain visible as saved values but are not compared to market prices. This contract does not authorize extracting model text as numeric analysis or choosing an entry-price formula; writers must use approved methods and preserve method/input/source snapshots.

Distance is a geometric comparison to a user's already saved range: inside = 0; below = `(close / lower - 1) × 100`; above = `(close / upper - 1) × 100`. Signed percentages refer to the nearest boundary, not a fair-value discount or margin-of-safety estimate. Sorting uses absolute distance. Currency must match and complete verified cached split-factor coverage must show no share-basis change since the reference date; otherwise distance is N/A. Near-entry filtering additionally requires a recent successful cache (24 hours), a close within seven calendar days and no last-sync failure. The displayed threshold is a user filter, not a trading recommendation.

## Storage and local operation

Schema-only migration **`20261012000300_watchlist_workspace`** adds `WatchlistResearchStatus` and `WatchlistDetails` (unique instrument FK, status/tags/notes/revision/timestamps). There are now **15 application tables**, all initially empty. No domain migration/seed is included. `WatchlistDetails` is local instrument metadata, not a user/account/ownership entity.

```sh
cd backend-project
npm run db:migrate
npm run build
node --test --test-reporter=spec test/*.test.mjs
node scripts/test-database.mjs
node scripts/verify-database.mjs --expect-empty
npm start
```

```sh
cd frontend-project
npm run build
npm test
npm run dev
```

The browser URL must match `FRONTEND_ORIGIN`. This machine's ignored `.env` was aligned to `http://127.0.0.1:5173` for the existing in-app browser; keys/database/SEC settings were retained. The tracked template retains its documented localhost default. Backups include the new annotation table under the existing [database procedures](DATABASE.md).

Tests cover empty/no-initial-data reads, confirmation/duplicates, metadata revisions, removal/re-add retention, optional durable imports, provider failures, filter/sort/scenario comparability and a real temporary backend-process restart. Fixtures exist only in test modules and guarded disposable databases. Browser smoke testing opens/closes the Add Stock dialog without submitting a lookup/import or inserting personal domain data.

## Validation record

Implementation validation on October 12, 2026:

- Backend build passed; 75 unit/HTTP/provider tests passed.
- Guarded disposable-database integration suite passed all 28 tests, including migration replay and backend-process restart persistence.
- Frontend production build passed; 17 component/foundation tests passed across six files.
- All three migrations are applied to the personal database. Its 15 application tables were verified empty after browser inspection.
- Backend and Vite listen on `127.0.0.1:7001` and `127.0.0.1:5173`. The empty workspace and unconfirmed Add Stock dialog were inspected in the browser.
- Diff whitespace checks and secret-value checks of changed files/frontend output passed. No packages, sample data or live provider imports were added.

Live Tiingo search/import remains unverified: automated tests use mocked provider payloads. Non-blocking output includes Vite's approximately 609 kB main-chunk warning, jsdom limitations parsing Ant Design CSS and an existing Stock Research Drawer deprecation. Full Stock Research data wiring, scenario creation and AI research generation remain later phases.
