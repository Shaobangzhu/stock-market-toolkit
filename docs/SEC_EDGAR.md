# SEC EDGAR financial integration

Implemented 2026-10-12. SEC is the official filings/fundamentals provider. Tiingo remains the sole market-price provider; OpenAI remains the planned qualitative/news provider. No paid fundamentals service, API key, startup import, ticker preload or sample data is introduced.

## Official sources and access policy

- [EDGAR public API specification](https://www.sec.gov/search-filings/edgar-application-programming-interfaces): submissions and companyfacts require no authentication or API key. Submissions include recent filing columns and references to older history files. Companyfacts aggregate standard-taxonomy, entity-wide facts; custom tags and dimensional/segment facts are outside this feed's comparable coverage.
- [SEC developer resources](https://www.sec.gov/about/developer-resources): no more than 10 requests/second per user across machines; tools must identify themselves and download efficiently.
- [Accessing EDGAR data](https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data): declare a contact-bearing User-Agent; ticker/exchange/CIK associations are not guaranteed complete or accurate. Verify directory matches against issuer submissions. Filing archive paths identify the CIK and accession.
- Official endpoints: `https://www.sec.gov/files/company_tickers_exchange.json`, `https://data.sec.gov/submissions/CIK##########.json`, and `https://data.sec.gov/api/xbrl/companyfacts/CIK##########.json`.

Use the existing ignored `backend-project/.env` settings `SEC_EDGAR_USER_AGENT` and `SEC_EDGAR_MAX_RPS`. Enter your real application identity/contact and restart the backend. There is no default or invented operational email. Missing contacts and known placeholder/reserved domains leave SEC unconfigured, while backend startup and cached reads work. Configuration accepts only printable contact-bearing values and integer rates 1–10; the default is a conservative 2 requests/second.

One local backend owns the provider queue. Requests are serialized and PostgreSQL advisory-lock admission spaces attempts across app processes. Reservations and 403/429 cooldowns persist in `ProviderRequestUsage`. Other programs on the same IP also consume SEC fair-access capacity and cannot be observed by this application; reduce the rate when sharing access. No SEC request is made from a browser or a GET/startup path.

Requests have a 15-second timeout including streamed body reads, a 32 MiB decoded response bound and three total attempts for network/408/5xx failures, with bounded exponential delays. Other client errors and malformed payloads are not retried. SEC 403/429 stops the request immediately, persists cooldown and honors `Retry-After`; absent/invalid headers use a conservative 60-second pause. Raw errors, response bodies and the contact value are not logged/reflected. URLs are adapter-owned HTTPS endpoints; redirects and unvalidated historical filenames are rejected.

Successful JSON responses have a bounded 32-entry in-memory cache: directory 24 hours, submissions/history/companyfacts 15 minutes. Restart discards only that response cache. PostgreSQL filings/facts remain readable through provider outages. Cache reads never trigger network requests.

## REST contracts

All endpoints use `/api`, `{data: ...}` successes and existing safe error envelopes. Initial sync requires a stored instrument identity; explicitly resolve/import the stock through the existing market workflow first. This integration does not insert Watchlist membership or guess listing metadata.

| Endpoint | Behavior |
| --- | --- |
| `GET /api/stocks/:symbol/fundamentals` | Cache only. Optional `exchange`, `asOf` (ISO timestamp with timezone, no future cutoff), `limit` (period groups, default 12, max 40). Returns reported/derived metrics, sources, period classification, valuation availability, method version and freshness. |
| `GET /api/stocks/:symbol/filings` | Cache only. Optional `exchange`, `asOf`, `form=10-K\|10-Q\|8-K` (includes amendments), `limit` (default 50, max 200), `after` (UUID cursor from preceding page). Returns publication/report dates, amendment flags and official document links. Keep `asOf` and filters fixed when paginating. |
| `POST /api/stocks/:symbol/fundamentals/sync` | Explicit submissions + companyfacts refresh. JSON body `{}` or `{ "exchange": "..." }`. Returns 202 and job ID with `Location: /api/sync-jobs/:id`. No financial-data import occurs on page load. |
| `GET /api/sync-jobs/:id` | Shared job status endpoint now also accepts SEC fundamentals jobs; success includes imported counts and coverage metadata. |
| `GET /api/providers/sec-edgar` | Configured flag, status based on last explicit sync, active jobs and safe failure/cooldown metadata. No live probe. Missing contact is Not Configured; no verified sync is Unknown; stale successes are Unknown. Other last-known states include Online, Error and Rate Limited. |

POST retains allowed `Origin`, JSON content type and `X-Stock-Research-Lab: 1` requirements. Unknown stored stock is 404; ambiguous listing is 409; missing configuration/storage is 503; unsupported SEC coverage is 422; rate limits are 429; invalid/transient provider payloads are 502. Async job failures expose codes/retry times on the job rather than pretending 202 means imported data.

Stored instruments with no imported issuer return empty periods/filings and unavailable freshness. Supported tags with missing values return `null` and a reason; missing data never becomes zero. Numeric API values are decimal strings, including percentages and ratios.

## Normalization and persistence

Ticker resolution canonicalizes case/share-class separators, matches exchange and CIK, rejects ambiguous matches, and verifies the result against submissions tickers/exchanges. An existing issuer CIK cannot change automatically. Symbols absent from the current SEC directory, delisted listings and unusual exchange mappings remain explicit unsupported states; never infer issuer identity from company-name similarity.

Retrieve all referenced historical submissions files (maximum 100 per issuer). Preserve 10-K, 10-Q, 8-K and `/A` variants; do not infer filing publication from a fact-only accession. Missing/mismatched filing references reject the entire import. Archive filenames, column lengths, accessions, dates, units and financial payloads are validated. First imports cannot prove that an otherwise well-formed SEC response contains all conceivable disclosures; `historyComplete` means all referenced submission files were fetched, not complete metric coverage.

Reuse `Issuer`, `SecFiling`, `CompanyFact`, `ProviderSyncJob`, `ProviderSyncState` and `ProviderRequestUsage`; no new schema/migration is needed. A single bounded transaction commits issuer linkage, filing/fact imports, both dataset freshness states and job success. An existing accession cannot change issuer/form/publication identity. Unique filing/context constraints make repeated imports idempotent. All facts keep reporting dates, fiscal hints, taxonomy/concept/unit, accession, original numeric lexeme and retrieval time. Numeric lexemes are captured before JavaScript Number conversion and must fit Decimal(38,12) without rounding.

Observation hashes include period and exact value. Duplicate frames/fiscal hints for the same disclosure do not become multiple financial amounts. A later filing's restatement is a separate observation; different values for the same context/accession remain preserved and make the affected metric ambiguous. Refreshes omitting previously stored filing/fact contexts fail atomically, retaining valid records and successful freshness. Legitimate SEC removals/corrections can therefore require manual investigation; no automatic purge is performed.

Jobs are serial, admission is transactional, duplicate active requests reuse a job, and at most ten SEC jobs remain active. Heartbeats cover queued/running work. Graceful stop aborts requests and records interruptions. No startup replay occurs. A later explicit POST marks jobs with heartbeats older than five minutes interrupted before admitting a retry. Process/DB failure can leave a job for that explicit stale-job recovery.

## Financial definitions and availability

Versioned US-GAAP tag mappings cover reported revenue, net income, diluted EPS, operating cash flow, acquisition payments for property/plant/equipment, cash/equivalents, operating income and selected debt components. DEI outstanding shares are retained for conservative market-cap comparability checks. Aliases are alternatives, never amounts to sum. The newest eligible disclosure is selected; mapping priority breaks compatible alias ties. Each metric carries original source observations, accession/link, publication and retrieval timestamps.

- Period grouping uses explicit start/end dates, never just `fy`/`fp` labels. Durations of 330–400 days are annual, 70–110 days standalone quarters, intermediate durations YTD; instants have no start. Other/transition periods are unsupported for annual valuation. These are duration classifications, not guaranteed issuer fiscal-calendar labels; unusually short annual/transition years need a future calendar policy.
- Quarterly values and YTD values remain separate. No automatic YTD subtraction, Q4 estimation, TTM aggregation or duplicated-fact summation is performed. EPS is reported diluted EPS, not synthesized by subtracting YTD EPS.
- Free cash flow is explicitly **derived**: operating cash flow minus positive reported property/plant/equipment acquisition payments, with identical period, currency and accession. Unsupported negative capex signs return unavailable. This narrow definition is not an issuer's adjusted/non-GAAP FCF.
- Operating/net margin use comparable same-period/same-accession income divided by positive revenue, multiplied by 100. Do not combine partially amended denominators with unamended numerators.
- Revenue growth is year-over-year, matching unit/concept and duration classification, with year-separated end dates and duration lengths within seven days. Nonpositive prior revenue and ambiguous periods are unavailable.
- Total debt requires short-term borrowings plus an inclusive long-term aggregate, or current/noncurrent long-term components from the same disclosure. Absent short-term debt is not assumed zero. The returned method states that operating leases are excluded; unsupported tags leave the result unavailable.

## Historical point-in-time policy

`asOf` filters by filing acceptance time, not financial period end. Later amendments and comparative restatements are excluded until published. Where acceptance time is unavailable, availability is conservatively the following day at 05:00 UTC, after the filed date in Eastern time. Rows retain filed dates and distinguish exact versus conservative publication precision.

SEC's current companyfacts API is **not a guaranteed vintage archive**. If SEC corrected/removed the original accession before this app's first import, the original value cannot be reconstructed. Conflicting versions observed locally are preserved and withheld from derived metrics, rather than selecting a later correction for an earlier cutoff. Returned retrieval times and explicit limitations identify this boundary. Historical instrument names/share-class directory membership are likewise not reconstructed. Future saved research must snapshot the exact returned source IDs/values, cutoff and method version.

## SEC facts versus market-derived valuation

**Overview addition:** `valuation.marketCapitalization` now returns cached RAW price times positive same-date published shares for a matching currency and single listed class, or a missing-data reason. P/S also rejects same-date share facts published after the quote date. [Stock Research Overview](STOCK_OVERVIEW.md) documents the frontend integration and its validation.

SEC does not supply market prices. Valuation combines eligible SEC disclosures with stored **Tiingo RAW daily closes**, never adjusted total-return prices, and does not fetch price data implicitly. Prices must be in the same currency, no older than seven calendar days at the research cutoff, and within 450 days of the annual period end. Current-day EOD availability is conservatively delayed to avoid treating an unpublished close as known.

- P/E is raw close / **annual diluted EPS**, explicitly not TTM. EPS must be positive and known by the quoted trading date; zero/negative earnings return `NON_POSITIVE_EARNINGS`. A single listed class and complete verified cached split-factor coverage between reporting end and quote are required. The existing market calendar verifies only 2026, so most older share-basis checks remain unavailable. Any split, missing corporate-action field, calendar gap or unsupported calendar returns `UNVERIFIED_SHARE_BASIS`.
- Price/Sales uses price × positive outstanding shares / positive annual revenue. Shares must be reported for the exact quote date and the issuer must have one verified listed class. No stale share-count extrapolation, multi-class aggregation or price/FX conversion is made. This frequently returns unavailable, with an explicit reason.
- Multi-class issuers, custom/IFRS concepts, segment data, TTM metrics, non-GAAP adjustments, enterprise value and automatic ratio estimates are outside this version. Missing facts or unsupported comparability do not generate values.

## Run and troubleshoot

From `backend-project/`:

```sh
npm run build
node --test test/*.test.mjs
npm run test:integration
npm start
```

Tests use synthetic official-format SEC payloads and the guarded runner's disposable databases exclusively. No SEC live call or personal stock import is required. Existing database migrations and backups remain unchanged; see [DATABASE.md](DATABASE.md).

For Not Configured, provide your own real contact User-Agent and restart. For 403/429, wait for `retryAfter`, lower request rate, check other local programs and retry explicitly. For CIK conflict or omitted contexts, inspect official issuer/filing links before accepting any identity/data change. Missing companyfacts/custom-tag coverage is an unsupported-data state. Cached results remain available while the provider is down; freshness becomes stale after 24 hours or a failed refresh. A recent successful snapshot is not proof that no newer SEC filing exists.

## Validation record (2026-10-12)

`npm run build` passed. The full `node --test --test-reporter=spec test/*.test.mjs` suite passed **72 tests**, including SEC normalization, publication/method rules, safe configuration, mocked retries/timeouts and HTTP contracts. The guarded `node scripts/test-database.mjs` runner replayed existing migrations into a fresh disposable database and passed **20 integration tests**, including SEC idempotency, point-in-time amendments, atomic rollback, partial-response preservation, rate cooldown, reconnect persistence and interruption/recovery. The runner removed only its own temporary database.

The rebuilt backend was restarted on `127.0.0.1:7001`; read-only health, readiness and SEC status returned 200. SEC contact is configured locally, with status Unknown because no live sync was performed. The personal database verifier confirmed **14 application tables, zero total rows** after restart; both existing migrations remain applied. No new migration, dependency installation, real stock import, live SEC provider call or change to the local `.env` was made. `git diff --check` passed.
