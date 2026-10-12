# Tiingo daily market data

Implemented 2026-10-12. This phase adds the backend provider, cache and explicit sync jobs. Frontend chart wiring and Watchlist membership are separate work. All automated provider requests are mocked; no live import or credential test has been run against the personal database.

## Configuration and verified provider contract

Tiingo is the sole MVP market-price provider; no primary/fallback selector or automatic fallback is configured. The other two external providers are SEC EDGAR for filings/fundamentals and OpenAI for news/qualitative research. Valid PostgreSQL cache remains available during outages, with stale/unavailable status reported honestly. Additional providers are outside the MVP.

Keep `TIINGO_API_KEY` in the ignored `backend-project/.env`. Restart the backend after changing it. The adapter receives validated backend configuration, sends `Authorization: Token ...` to its fixed HTTPS endpoint, rejects redirects, and never includes tokens in URLs, responses, snapshots or logs. Missing credentials allow startup and cached reads; synchronization returns 503 `PROVIDER_NOT_CONFIGURED`.

Official sources checked on 2026-10-12:

- [EOD endpoints](https://www.tiingo.com/documentation/end-of-day): metadata reports available dates; history returns raw/adjusted OHLCV, cash dividends and split factors. Adjusted prices include both splits and dividends.
- [Connecting](https://www.tiingo.com/documentation/general/connecting): header-based token authentication.
- [Limits and symbology](https://www.tiingo.com/documentation/general/overview): hourly/daily requests and monthly bandwidth; share classes use dashes.
- [Starter pricing](https://www.tiingo.com/about/pricing): 50 requests/hour, 1,000/day, 500 symbols/month and 1 GB/month. These verified limits are the defaults.

Validated configuration supports `TIINGO_MAX_REQUESTS_PER_HOUR`, `TIINGO_MAX_REQUESTS_PER_DAY`, `TIINGO_MAX_SYMBOLS_PER_MONTH`, and `TIINGO_MAX_BYTES_PER_MONTH`. Existing `.env` files need no changes for defaults. Lower limits if another app shares the account. Raise them only for a verified account plan. This app cannot observe requests made elsewhere; provider 429 responses remain authoritative.

`ProviderRequestUsage` records every outbound attempt, including metadata, latest quotes, retries and failed lookups. PostgreSQL advisory locks serialize quota admission across processes. Limits use conservative rolling one-hour, 24-hour and 31-day windows. Each request reserves 8 MiB before sending and replaces that reservation with received decoded bytes after a complete read. Interrupted reads retain the reservation. This safely overestimates compressed wire bandwidth; usage survives restarts and is not automatically purged.

Requests are serialized, time out after 10 seconds including body reads, and make at most three attempts. Network errors/5xx use short exponential delays; 429 honors numeric or HTTP-date `Retry-After`. A cooldown of at most two seconds can be retried; longer cooldowns fail the job and persist retry eligibility. Missing headers use a conservative local 60-second pause, not a claimed provider quota. 401/403 are never retried and block further requests in that process until the key is corrected and the backend restarts. Raw error bodies are never logged or reflected.

## Endpoints

Endpoints follow the existing `/api` namespace, `{data: ...}` success envelopes and `{error:{code,message,requestId}}` failures. POST requires an allowed `Origin`, `Content-Type: application/json`, and `X-Stock-Research-Lab: 1`.

| Endpoint | Contract |
| --- | --- |
| `GET /api/stocks/:symbol/prices` | Cache only. Query: `from`, `to`, `after` (exclusive date cursor), `exchange`, `adjustment=raw\|total-return`, `limit` (default 1,000; max 5,000). Bars are oldest first; `nextAfter` continues pagination. Includes latest stored EOD for that series, identity, provenance and freshness. Unknown stored instruments return 404. |
| `POST /api/stocks/:symbol/sync` | Body: `startDate`, `endDate`, `fullHistory`, `exchange`. Initial import requires `startDate` or `fullHistory: true`; those options are mutually exclusive. Returns 202 with a durable job and `Location: /api/sync-jobs/:id`. |
| `GET /api/sync-jobs/:id` | Status, safe error code, retry eligibility and final import metadata. A 202 admission does not mean data was successfully saved. |
| `GET /api/providers/tiingo` | Configured flag, last request/error, last job, cooldown and active-job count. No external requests or secrets. |

Symbols are validated, uppercased and canonicalized from share-class periods to Tiingo dashes. Ambiguous stored identities require `exchange`; listing mismatches return 409. Unsupported provider symbols return 404, invalid requests 400, unsupported exchange/coverage 422, exhausted quota 429, provider failures 502, and missing configuration/storage 503. Synchronous rate errors include `Retry-After`; asynchronous failures expose `retryAfter` on the job.

An explicit sync may create a verified instrument identity. It does not add Watchlist membership or use another provider. GET, installation, migration and startup do not create instruments, preferences, jobs, request-usage rows or prices.

## Synchronization and persistence

Initial ranges are clipped to provider availability. The default end is the independently fetched latest EOD date, not today's assumed session. Non-overlapping five-year chunks bound responses, with application ceilings of 50 years, 20,000 raw daily observations and 8 MiB per response. These are safety bounds, not Tiingo entitlement claims; account coverage can be shorter.

Subsequent `{}` syncs request the last cached raw date minus seven calendar days through the latest provider date. This overlap captures recent corrections. Explicit `startDate` revisits/extends history; `fullHistory: true` requests the provider's earliest available date within the application bound.

RAW and TOTAL_RETURN observations remain separate. Missing adjusted values are never replaced with raw values; partial adjusted fields or inconsistent availability reject the response. Disappearance of previously available adjusted data rejects the sync. New corporate actions or changed adjustment ratios in the overlap trigger a download of the entire cached span before commit. Historical corrections outside that overlap require an explicit wider/full-history sync.

JSON numeric lexemes are captured before JavaScript Number conversion. Decimal arithmetic validates original OHLC consistency and nonnegative integer raw volume. Prices/adjusted volume are explicitly rounded half-up to eight decimal places; split factors use twelve. Exact original fields remain strings in `sourceData`, alongside source hashes, cash dividends, split factors and retrieval timestamps. API Decimal values are strings. Daily timestamps are midnight UTC date keys with separate trading dates and exchange timezone, not exchange opening/closing instants.

All chunks validate before one transaction bulk-upserts bars, updates coverage/freshness and marks the job successful. Unique series/timestamp constraints prevent duplicates. Unchanged source hashes leave revisions unchanged; source corrections increment revisions. Truncated responses, duplicate/out-of-range dates, omitted known stored dates, missing provider coverage endpoints and inconsistent latest/history snapshots fail without replacing prior bars or successful freshness. Failure counters and error codes are separate from prior success.

Jobs run serially in the local process, with at most ten durable active jobs. A partial unique index and serialized admission deduplicate active work for an instrument/provider/dataset. Heartbeats include queue time. Graceful shutdown aborts provider requests, records unfinished jobs as INTERRUPTED, then closes PostgreSQL. Crashed jobs remain inspectable and are not replayed at startup. A later explicit POST can mark a heartbeat older than five minutes INTERRUPTED and admit a new run. Failed imports need explicit retries. Job `attempts` counts logical provider operations; request-usage rows count every actual HTTP retry, including initial identity lookup before job creation.

## Coverage limitations

Recognized US codes include NASDAQ, NYSE, NYSE Arca/MKT/American, AMEX, BATS/Cboe BZX and selected OTC codes, with explicit USD and `America/New_York` metadata. Tiingo metadata does not provide currency/timezone; unknown exchanges are rejected. Foreign listings, unrecognized fund exchanges, intraday/live quotes and synthesized split-only series are outside this phase.

Weekend observations are rejected. NYSE/Nasdaq full-day closures for **2026** are verified against the [NYSE schedule](https://www.nyse.com/trade/hours-calendars) and [Nasdaq schedule](https://nasdaqtrader.com/Trader.aspx?id=Calendar), including Good Friday and observed Independence Day. Early-close days remain valid. Missing known NYSE/Nasdaq sessions reject the sync; suspended/no-trade instruments may require a future explicit gap policy. Other years and BATS/OTC calendars remain unverified and are marked accordingly. No gap is silently declared a holiday and no fabricated/zero bar is inserted.

`currentAtLastSync` compares stored coverage with the provider date observed at the last successful sync. It does not claim a live quote or prove publication of today's close. Calendar coverage is bounded/versioned and must be refreshed before another year is treated as verified.

## Operations and validation

From `backend-project/`:

```sh
npm run build
npm test
npm run test:integration
npm run db:migrate
npm run db:status
node scripts/verify-database.mjs --expect-empty
npm start
```

Integration tests create a guarded random database in `srl-postgres`, replay both migrations, use mocked Tiingo responses, reconnect to verify persistence, and remove only that disposable database. Existing [backup/restore instructions](DATABASE.md) include these new tables.

Applied migration: `20261012000200_tiingo_market_data`, following the initial foundation. Local schema is up to date; all 14 application tables were verified empty after migration. No live Tiingo test has been performed.

Verification record: `npm run build` passed; the complete Node unit/HTTP suite passed **61 tests**; the guarded database runner passed **12 integration tests** after replaying both migrations on a fresh database. These include exact-number parsing and adjustment comparisons, idempotency, incremental ranges, corporate-action rebasing, partial-response preservation, quotas, persistence after reconnect and graceful interruption. `npm run db:migrate`, `npm run db:status`, and the personal-database empty check passed. Backend liveness/readiness, provider status and Vite-proxied readiness passed read-only HTTP smoke checks. No packages were installed; existing `.env` secrets were preserved. Test databases created by these runs were removed; unrelated Docker resources were untouched.
