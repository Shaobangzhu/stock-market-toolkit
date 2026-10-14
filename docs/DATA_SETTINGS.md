# Data & Settings

The `/settings` workspace uses the established local navy theme, Ant Design and same-origin typed APIs. It shows four summary cards and exactly **three** MVP providers: Tiingo, SEC EDGAR and OpenAI. The request's references to four external providers conflict with its three-name list and the approved scope; no additional provider is introduced.

## Status evidence

Opening Settings runs only database reads. It never contacts external providers, creates instruments/jobs, imports data or saves preference defaults. `Refresh Status` refreshes local evidence; it is not an outbound connectivity test.

- Not Configured: the backend's corresponding key is absent, or SEC User-Agent is absent/recognized as a placeholder by the existing SEC adapter policy.
- Unknown / Not Tested: configured, but there is no saved successful synchronization, or database evidence is unavailable.
- Online: a saved successful provider sync exists and is not superseded by a more recent error. This is historical verification, not a claim that the provider is reachable now. The last-success timestamp remains visible.
- Rate Limited / Error: the most recent request or completed job records a subsequent rate-limit/other failure. A later successful synchronization clears the displayed failure status.
- OpenAI remains Unknown / Not Tested when configured because the research executor/connectivity test is not implemented. Saving preferences does not test it.

The Tiingo quota column shows actual application request reservations in the rolling previous hour against the **configured local hourly budget**. It is not account-wide usage or a verified account entitlement. SEC/OpenAI usage is unknown; no numbers are invented. Database health executes actual PostgreSQL queries and reads engine version, database name, counts and date bounds. A failed database read gives Unavailable and unknown counts, rather than zeros. Research-report count includes successful `ResearchRun` records only. Price-record count includes each stored adjustment series, not distinct trading days. Pending count includes persisted queued/running jobs, including abandoned work until explicit recovery.

## API contracts

All responses use `{data: ...}` and existing sanitized errors. No credential, connection URL, SEC contact email or raw driver error is returned. Existing Host/Origin/JSON/custom-header protections apply to every write.

| Endpoint | Behavior |
| --- | --- |
| `GET /api/settings/status` | Read local provider evidence, DB diagnostics and nonsecret environment state; works in a degraded state without PostgreSQL. |
| `GET /api/settings/preferences` | Return validated stored preferences, or code defaults without inserting a row. |
| `POST /api/settings/preferences` | Validate and save the entire allowlisted preference object; HTTP 200. |
| `GET /api/settings/jobs?offset=0` | Latest jobs, 50 per page, with sanitized error/retry information. |
| `GET /api/settings/coverage?offset=0` | Existing instruments, 50 per page, with separate provider/interval/adjustment/currency/timezone series counts and bounds. Bounds alone do not prove completeness. |
| `POST /api/settings/sync-watchlist` | HTTP 202; submit price jobs sequentially through the existing deduplicating runner, returning per-stock acceptance/errors. Empty Watchlist creates no jobs. Maximum 100 stocks per batch. Cached stocks use incremental updates; first imports request full provider history. The runner's queue/coverage/quota limits still apply. |
| `POST /api/stocks/:symbol/sync` | Existing selected-stock action with `exchange` and `fullHistory: true`; HTTP 202 means accepted, not completed. |
| `POST /api/settings/retry-sync` | `{jobId}`; HTTP 202. Only failed/interrupted Tiingo or SEC jobs; honor future `retryAfter`, keep original jobs and delegate new work to the existing runner. |
| `POST /api/settings/import-csv` | `{csv}`; HTTP 201. Validate and atomically append supported manual notes. |
| `GET /api/settings/export-research` | Downloadable `research-export-v1` JSON with export time, numeric encoding, instruments, successful reports/sources, immutable scenarios and manual notes. |

Job/coverage pagination accepts offsets 0–10,000. No startup recovery/replay is added. The page polls visible pending jobs, updates status/coverage and retains errors for explicit retry. Existing workers may enforce stricter queue limits than a large Watchlist batch can accept; partial acceptance is displayed explicitly.

## CSV format and import safety

Supported schema is `manual-note-csv-v1`, with exact header:

```csv
symbol,exchange,title,content
```

The file must contain 1–100 data rows. Symbols/exchanges must be uppercase and already exist as an exact instrument identity. Each title is 1–160 characters and content is 1–12,000 characters. UTF-8 BOM, CRLF/LF, quoted fields, embedded commas/newlines and doubled quotation marks are supported. Malformed quoting, missing/extra columns, unknown instruments and invalid fields reject the **entire transaction**. There is a 30,000-character CSV bound and the existing 32 KiB encoded JSON request bound; highly escaped/multibyte content can reach the request bound earlier.

The UI accepts a local CSV file or pasted text. No symbol catalog, provider import, price replacement, or legacy-data migration occurs. Every successful row creates a new immutable manual-note series, version 1, with import provenance and creation cutoff. Historical quote is unavailable, deliberately null; an import does not pretend the note was researched at a different price/date. Reimporting the same file explicitly creates new note series; import is not a deduplication or restoration feature. Existing price and report records are never changed.

## Preferences and export limits

One sparse `AppPreference` override (`research-preferences`, schema version 1) stores lookback 1–20 years, concise/standard/detailed report level, technical/fundamental/news booleans and an optional exact nonnegative USD decimal string with at most two fractional digits. Unknown keys are rejected. Defaults need no database row. An empty budget means no guardrail; zero is valid. The budget is a saved preference for the future AI executor, **not current spend measurement or enforcement**. API keys stay in ignored backend `.env`, with no browser key form or storage.

Research export uses a repeatable-read transaction and serializes financial decimals as strings. Export is capped at 5,000 rows per entity and fails explicitly above the bound, rather than silently truncating. It preserves original input/output snapshots, assumptions, source evidence, versions and note content. It is not a full database backup or an importable restore format; market bars, SEC facts, preferences and operational jobs are outside this research export. Use [PostgreSQL backup/restore](DATABASE.md) for a complete backup, and restore into a separate database first. No purge/reset/delete UI is added.

## Validation

Automated checks cover empty/degraded status, missing provider configuration, credential-free responses/logs, input/local-write boundaries, CSV quoting/validation/atomic rollback, immutable imports, exact preferences across independent backend processes, truthful provider success/error/rate-limit/recovery, sync retry/backoff, cached incremental batch behavior, real coverage and JSON export. Frontend component checks cover empty states, exactly three providers, unknown availability, errors, explicit saves/sync/import/retry, coverage and download.

The implementation uses existing models/migrations, without dependencies or `.env` changes. Fixtures run only in mocked component tests or a newly created disposable PostgreSQL database. Live provider calls and paid research are not part of automated validation.

Verification on 2026-10-14:

- Backend `npm run build` and `node --test test/*.test.mjs`: 93 tests passed.
- Guarded `node scripts/test-database.mjs`: 44 integration tests passed; three existing migrations replayed on a new isolated database, then only that database removed.
- Frontend `npm run build` and `npm test -- --reporter=dot --maxWorkers=2`: 63 tests passed in 14 files. The default worker run hit resource-related five-second timeouts; bounded workers passed the entire suite. Existing nonblocking Vite chunk-size and jsdom CSS warnings remain.
- `node scripts/verify-database.mjs --expect-empty`: 15 personal application tables, total 0 rows; all three existing migrations applied.
- Browser verification: real empty page, provider evidence, coverage empty Modal, no console errors, and 410px responsive layout without body overflow. No preferences/imports/provider actions were written to the personal database during verification.
