# Valuation & Entry Intelligence

Implemented in Stock Research Overview, within Entry Research. There is no new page or tab, execution action, provider request, or LLM arithmetic. `ValuationEngine` is pure deterministic TypeScript using the existing Prisma Decimal implementation; `services/valuation.ts` coordinates cache reads and immutable saves. `repositories/valuation.ts` selects published SEC facts and raw Tiingo EOD observations. All financial assumptions are entered explicitly; the form supplies no sample prices, growth forecasts, multiples, or entry targets.

## Methods and assumptions

Each calculation contains Bear, Base and Bull cases. Each case chooses one of:

- **PE**: an identified annual SEC diluted EPS observation, growth, whole-year horizon, target equity P/E multiple, equity discount rate and an explicit user note verifying the assumed share basis.
- **PS**: an identified annual SEC revenue observation, growth, horizon, target equity P/S multiple, equity discount rate, assumed forecast diluted shares and a user note explaining the share/dilution assumptions. This is P/S, not EV/Sales; no enterprise-value or debt bridge is implied.
- **DIRECT**: positive user-estimated present fair value and its rationale/source. This is explicitly a user assumption and is available when SEC fundamentals cannot support a multiple model. It does not invent missing financial data.

PE rejects non-positive EPS. PS rejects non-positive revenue and share counts. SEC multiple methods require one verified listed issuer ticker; multiple or unknown share classes require a direct user estimate. No split conversion, share-class allocation, dilution forecast or currency conversion is inferred. The user must verify the reported EPS basis or enter a comparable future diluted share count. These notes are assumptions, not proof supplied by the application.

All cases use the same instrument, currency, UTC cutoff and cached raw EOD reference. Fair values must satisfy Bear ≤ Base ≤ Bull; cases are not silently relabeled. Different case methodologies are allowed and remain visible.

## Exact formulas (`valuation-v1`)

Let `g` be annual growth / 100, `r` equity discount rate / 100, `n` forecast horizon in whole years, `M` target equity multiple, `S` user-assumed diluted shares at the forecast horizon. Forecasts start from the selected annual metric at the scenario cutoff. There is no inferred stub-period growth, fiscal alignment to today's run rate, or TTM conversion.

| Quantity | Formula |
| --- | --- |
| Forecast metric | `reportedAnnualMetric × (1 + g)^n` |
| PE terminal equity price | `forecastAnnualDilutedEPS × targetPE` |
| PS terminal equity price | `forecastAnnualRevenue × targetPS / S` |
| Multiple-model present fair value | `terminalEquityPrice / (1 + r)^n` |
| DIRECT fair value | user-entered present per-share estimate |
| Fair-value range | Bear fair value through Bull fair value |
| Margin of safety (ratio) | `(fairValue − referencePrice) / fairValue` |
| Margin of safety displayed as percent | ratio above × 100 |
| Current-price premium / discount | `(cachedClose / fairValue − 1) × 100`; positive premium, negative discount |
| Safety-derived entry lower bound | `fairValue × (1 − maximumPlannedSafetyPercent / 100)` |
| Safety-derived entry upper bound | `fairValue × (1 − minimumPlannedSafetyPercent / 100)` |
| Manual entry zone | the user's ordered positive lower/upper prices |
| Planned-entry safety at lower / upper | MOS evaluated separately at the two saved entry bounds |
| Hypothetical-entry safety | MOS evaluated at the optional user-entered hypothetical price |

**Distance sign convention**, shared with the existing Watchlist: for price `P` and zone `[L,U]`, return `(P/L−1)×100` when `P<L`, `0` when `L≤P≤U`, and `(P/U−1)×100` when `P>U`. Thus a negative distance means below the lower boundary; positive means above the upper boundary. This is relative distance from the boundary, not a predicted return or the price move as a fraction of today's price.

Current-price MOS uses the cached EOD reference. Planned-entry MOS uses the planned bounds. Hypothetical MOS uses the optional hypothetical price. They are separately named in the API and comparison table. No current-price metrics are available without a cached comparable price. A stale observation retains its date and stale label, never becomes “Live.” Overview's current MOS uses the latest comparable raw close versus the saved Base Case; it stays unavailable if the existing share-basis/calendar checks fail.

Base Case entry bounds are projected into the Watchlist and Price & Volume chart. The Bear–Bull interval is the saved fair-value range. Existing chart rules suppress raw entry bands on adjusted series and avoid drawing targets before their creation date.

These multiple methods estimate only a discounted terminal equity price. They **exclude interim dividends and cash flows** and are not full DCF valuations or guaranteed returns. The distinction between equity multiples and enterprise-value multiples follows [Damodaran's terminal-value discussion](https://pages.stern.nyu.edu/~adamodar/New_Home_Page/valquestions/termvalapproaches.htm); the choice of an equity discount rate follows [Approaches to Valuation](https://pages.stern.nyu.edu/~adamodar/New_Home_Page/lectures/approach.html). These sources do not supply the user's assumptions.

## Validation and numerical precision

- Input financial values must be plain decimal **strings**, never JSON numbers, exponents, separators, NaN or infinity; up to 12 fractional places and a bounded 48-character lexeme. Horizons and version numbers are bounded integers.
- Growth: `−100% < growth ≤ 1,000%`; horizon 0–30; target multiple `0 < M ≤ 1,000`; equity discount rate 0–100%. A zero rate is an explicit undiscounted assumption. A zero horizon applies no growth or discounting.
- Planned safety: 0% inclusive to 100% exclusive, minimum ≤ maximum. Manual prices and forecast shares must be positive. Manual entries above fair value are allowed and honestly show negative planned MOS.
- Decimal arithmetic uses **80 significant digits**, ROUND_HALF_UP. Present fair value is rounded to 8 decimal places; entry calculations use that fair value, and bounds are rounded to 8 before ratio evaluation. Ratios and intermediate displayed forecast/terminal amounts round to 12 decimal places. No binary floating-point monetary arithmetic or monetary persistence is used.
- Supported stored price range is positive and below `10^16` at scale 8. Results rounding to zero or overflowing are rejected, not clipped. Rate precision is intentionally separate from stored monetary precision.
- Formula output JSON carries exact decimal strings. Creation time, formula version, assumptions, market row ID/revision/hash and selected fact metadata are persisted.

## Source selection and historical research

Reads are cache-only and never create instruments, facts, prices, jobs or reports. They are restricted to the requested symbol **and exchange**, listing currency, Tiingo daily RAW series, and instrument timezone. The cached EOD close must be at least 29 hours after its UTC daily date key at cutoff and locally retrieved by cutoff. This conservative daily availability policy is shared with the SEC integration; it is not a live or intraday clock.

SEC source facts are standard US-GAAP annual diluted EPS/revenue from supported 10-K/10-Q disclosures and amendments. Annual duration is 329–385 elapsed days; this applies a stricter upper limit than the general SEC classifier to avoid extending the forecast from unusually long reporting periods. The period must end by cutoff and be no older than 550 days. Quarters/YTD are not annualized or summed. Units must match the method and listing currency.

Publication uses SEC acceptance time, or conservatively the filed date plus 29 hours when acceptance is missing. Both publication **and local retrieval** must be no later than cutoff. For each concept/unit/start/end, the latest eligible publication supersedes older disclosures; conflicting same-publication values are excluded. Users select one identified fact rather than a sum of duplicative contexts. Selected accession, concept, unit, period, URL and timestamps remain in the snapshot.

This strict local-availability policy intentionally leaves historical gaps when data was first downloaded later. An overwritten price revision cannot be reconstructed from the current PriceBar table; an already saved scenario retains its complete original value and revision snapshot. SEC corrections before first import also cannot be reconstructed. User-entered assumptions created today must be labeled retrospective even with a historical cutoff. Replaying a saved snapshot remains reproducible; this feature is not a historical backtesting system.

Market freshness includes the existing sync state, a 24-hour sync-age limit and a seven-calendar-day observation-age limit. Later/missing sync metadata is conservatively marked stale or unverified at the historical cutoff. It is not proof of market-session completeness. The source query is capped at 10,000 relevant fact observations; history returns the latest 50 scenario versions.

## API and persistence

| Method / path (under `/api/stocks/:symbol/valuation`) | Contract |
| --- | --- |
| `GET /sources?exchange=...&cutoff=...` | Eligible SEC annual sources, raw price snapshot and source dates; no writes. |
| `GET /scenarios?exchange=...` | Latest 50 immutable scenario versions and exact stored inputs/results. |
| `POST /calculate` | `{exchange, cutoff, cases:{bear,base,bull}}`; returns assumptions, selected input snapshot, results and SHA-256 calculation hash; **no writes**. |
| `POST /save` | `{assumptions, expectedHash, seriesId?, expectedVersion?}`; recomputes from storage, verifies reviewed hash, saves a new version, returns 201. |

All POSTs require the established local Origin, JSON and `X-Stock-Research-Lab` protection. Zod rejects unknown fields, invalid decimal syntax and impossible inputs (400). Missing/unsupported financial inputs return 422 `VALUATION_UNAVAILABLE`. Changed sources or stale versions return 409 `VALUATION_CONFLICT`. Unknown instrument is 404; unavailable storage is 503 with redacted diagnostics.

`EntryScenario` already supports the complete contract; **no schema migration, seed, package installation or provider call** is needed. `method=BEAR_BASE_BULL`, `methodVersion=valuation-v1`; `assumptions` holds user inputs, `inputSnapshot` holds immutable source values/references and the calculation hash, and `resultSnapshot` holds all case outputs plus the existing Watchlist projection. Base Case bounds populate `lowerPrice/upperPrice`. Existing schema triggers protect saved scenarios from UPDATE/DELETE; `(instrumentId, seriesId, version)` is unique. Save uses a transaction and an advisory lock to serialize version checks; edits append a version and never mutate the old record. New Scenario creates a new series. Saves are explicit and not automatically retried by the UI.

No saved valuation becomes an AI research report. Saved versions and calculation details are reviewed inside Entry Research; the existing Research History Drawer remains report-focused.

## Verification

Numerical examples exist only in automated tests:

| Independent expected example | Expected result |
| --- | --- |
| EPS 5; growth 10%; 2 years; P/E 20; discount 10% | projected EPS 6.05; terminal 121; present fair value 100 |
| Revenue 1,000; growth 10%; 2 years; P/S 2; shares 100; discount 0% | revenue 1,210; fair value 24.2 |
| Fair 100, cached price 90 | current MOS 10%; premium/discount −10% |
| Planned safety 20–40% at fair 100 | entry zone 60–80; lower/upper planned MOS 40% / 20% |
| Hypothetical entry 70 at fair 100 | hypothetical MOS 30% |
| Price 90 vs zone 60–80 | distance +12.5% |
| Price 50 vs zone 60–80 | distance −16.666666666667% |
| User value 9007199254740993.123456785 | stored/display result string 9007199254740993.12345679 |

Tests also cover zero horizons/rates, negative growth, overflows, invalid rates, negative earnings, absent prices/facts, incompatible currencies/bases, quarterly/YTD exclusion, amended and ambiguous SEC facts, future publication/retrieval, immutable editing, concurrent version conflict, source revision conflict and replay after reconnect.

Commands: backend `npm run build`, `node --test --test-reporter=spec test/*.test.mjs`, `node scripts/test-database.mjs`; frontend `npm run build`, `npm test -- --reporter=dot`. Integration fixtures use the existing guarded temporary-database runner only. No application data is inserted by validation against the personal database.

Validated October 13, 2026: both builds pass; **89 backend tests, 36 isolated PostgreSQL integration tests and 54 frontend tests** pass. The personal database still has **15 application tables and zero rows**, with all three existing migrations applied. Desktop 1440px and mobile 410px browser checks confirmed the three-case editor, calculated entry ranges, honest missing-price metrics and no dialog overflow or browser console errors. Visual previews use isolated fixtures and reject saves. Existing Vite chunk-size and jsdom CSS warnings remain non-blocking.
