# Price & Volume workspace

Implemented at `/stocks/:symbol?tab=price-volume`. The shared EOD stock header and exactly two tabs remain. Opening/closing the right Research History Drawer preserves the active tab, controls, date window and slider zoom.

## Cached API contracts

- `GET /api/stocks/:symbol/prices?exchange=...&adjustment=raw|total-return&to=YYYY-MM-DD&limit=5000&after=...`: existing PostgreSQL-only daily OHLCV read. Browser pagination is bounded to four pages / 20,000 observations per basis. Every page validates identity, currency, exchange timezone, adjustment, ordered unique trading dates, OHLC consistency, finite positive prices, nonnegative volume, corporate-action fields and provenance. Decimal strings remain intact in cache; bounded numbers are used for chart/statistical display only.
- Each pagination series checks stable latest-bar and successful-sync metadata. A detected revision during pagination fails safely for explicit retry. The existing API has no cross-request repeatable-read snapshot; this is a consistency guard, not a transactional multi-page snapshot.
- `GET /api/stocks/:symbol/filings?limit=200`: latest stored filing publication dates and official links.
- `GET /api/stocks/:symbol/research?limit=50`: latest completed report metadata, versions and completion/cutoff timestamps.

GETs do not call providers, import instruments, launch jobs or save analyses. Existing explicitly confirmed Sync Data is the import workflow. Reads stop at the Overview response's as-of UTC date. Query keys/abort signals and stock-keyed workspace state prevent ticker leakage. Failed refreshes retain previous successful cache; failed adjusted reads leave raw history usable.

## Chart and controls

ECharts core registers Candlestick, Line, Bar and Scatter with linked category axes, crosshair, inside zoom/pan and a shared slider. Price and volume are derived from the same OHLCV row; candle ordering is `[open, close, low, high]`. Tooltips preserve the trading-date key, OHLC, volume, currency, provider, adjustment and exchange timezone. Dates are never converted from provider midnight timestamps into the previous US date.

Controls include candlestick/line, raw/total-return adjusted, SMA 50/200, EMA 20, Bollinger Bands (20, 2), RSI 14, MACD 12/26/9, volume and Reset View. Indicators are calculated over full cached history before slicing the visible window, so changing the range does not discard warm-up. Slider zoom is independent of date-window metrics and survives control/Drawer changes.

Ranges are 1M/3M/6M/1Y/3Y/5Y/MAX, anchored to the latest stored session with calendar subtraction clamped at month ends. A range is disabled when the cache begins after its boundary (four-day weekend/closure tolerance); unsupported initial 1Y falls back to MAX. MAX means all stored observations. Date inputs support historical inspection; metrics and indicator readings stop at the selected end date.

Adjusted mode requires a same-date adjusted bar for every raw observation, with the same instrument/currency/timezone. It uses adjusted OHLC **and adjusted volume**, without raw substitutions. Raw mode uses raw shares. The backend retains Tiingo split/dividend provenance and rebases adjusted history on corporate actions.

Known missing US trading sessions insert a labeled null/basis-break category, never a fabricated candle, zero-volume observation or interpolated price. Raw splits or unknown split factors restart calculations at the new observation. Every moving window/recursive indicator resets across a break. The current calendar matches backend `US_DAILY_2026_v1`; weekends and verified exchange closures are allowed. Outside 2026/unsupported exchanges, coverage is explicitly unverified, gaps over four calendar days break the series, and ordinary calculations describe stored observations rather than claiming complete daily coverage.

## Deterministic formulas and unavailable values

All formulas consume only the current observation and earlier inputs. No indicator output is persisted as money or used as an automated signal.

| Metric | Formula / minimum |
| --- | --- |
| SMA N | Arithmetic mean of N consecutive observed closes; N=50 or 200. |
| EMA N | Seed with SMA N; then EMA(t)=EMA(t−1)+[2/(N+1)]×[close(t)−EMA(t−1)]. N=20. |
| Bollinger Bands | SMA 20 ± 2 population standard deviations over those 20 closes; denominator 20. |
| RSI 14 | Seed mean gains/losses over 14 changes (15 closes); Wilder smoothing (prior×13+current)/14. RSI=100−100/(1+gain/loss). Zero loss with positive gain=100; zero gain with loss=0; both zero=50 (explicit neutral convention). |
| MACD | SMA-seeded EMA 12−EMA 26; signal=EMA 9 of available MACD values; histogram=MACD−signal. Line requires 26 closes, signal/histogram 34. |
| 52W high/low | Maximum high/minimum low in trailing calendar year on the selected basis, ending at the selected date. Partial coverage is labeled. |
| Average volume | Arithmetic mean of stored volume in the chosen window and adjustment basis; missing sessions add no values. |
| 30D historical volatility | Sample SD of the latest 30 daily log returns, denominator 29, ×√252×100. Requires 31 closes on consecutive verified sessions and compatible share basis. “30D” means 30 trading returns, not calendar days. |
| Maximum drawdown | Minimum(close(t)/runningPeak(t)−1)×100 in the chosen window; shown as a nonpositive percentage. |
| Selected period return | (last stored close/first stored close−1)×100 in the chosen window; observed endpoints are disclosed. |

Insufficient warm-up produces N/A, including short post-gap/split segments. Drawdown/return require at least two comparable observations and no detected gaps/basis changes. Volatility requires the verified daily calendar. Chart calculations use bounded JavaScript numbers for display and logarithms; PostgreSQL monetary persistence remains exact Decimal.

Formula references: Fidelity's [EMA](https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/ema), [RSI](https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/rsi), [MACD](https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/macd), and [Bollinger Bands](https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/bollinger-bands); [CME daily-log-return/252 convention](https://www.cmegroup.com/rulebook/files/S_5582.pdf). Seeding, estimator and minimum-data choices above are explicit application policies.

## Events, research and entry zones

`ChartEventMarker` is a reusable adapter interface for filing, verified earnings, major event and research annotations. Runtime markers currently come only from stored SEC filings and completed reports. An 8-K is labeled a filing; earnings dates are never inferred from forms, fiscal periods or headlines. There is no verified earnings/major-event feed implemented yet.

Filings retain the SEC publication date (exact release time unavailable). Reports retain their completion timestamp, displayed in exchange timezone, and use R1/R2/R3 according to the stored report version. Non-trading dates attach visually to the next stored session, retaining the original date in Recent Events. Research timestamps at/after 16:00 exchange-local time attach no earlier than the next observation; 16:00 is an explicit US daily display convention, not an early-close or intraday availability model.

Research clicks select the corresponding saved report, scenario or note in the [Research History Drawer](RESEARCH_HISTORY.md), with original snapshots and same-series version comparison. Markers use chronological per-stock ordinals (`R1`, `R2`, etc.), distinct from series version numbers. Events outside the chosen chart window have no plotted marker; Recent Events remains a bounded latest-events view. Official filing links are HTTPS SEC links.

Only a saved entry zone with matching currency and `TIINGO:DAY:RAW` basis receives a blue chart band. The band starts at the first observation after the saved-date/time anchor, never backcasting a future scenario. Adjusted charts do not convert raw targets. Missing scenarios show “No valuation scenario saved yet.” No valuation or entry formula was introduced.

## Validation

Commands:

```sh
# frontend-project
npm run build
npm test -- --reporter=dot
node ../backend-project/node_modules/tsx/dist/cli.mjs test/overview-preview.mjs

# backend-project
npm run build
node --test --test-reporter=spec test/*.test.mjs
node scripts/test-database.mjs
node scripts/verify-database.mjs --expect-empty
```

The preview is an isolated test server using test-only fixtures and built assets, with no environment secrets, database or provider access; it rejects mutations and closes after fifteen minutes/Ctrl-C. Fixtures are absent from production bundles. PostgreSQL integration tests create/migrate/clean only their guarded random disposable database.

Checks on October 13, 2026: both builds, 80 backend regression tests, 32 PostgreSQL integration tests and 50 frontend tests passed. Database tests replayed all three migrations. Coverage includes OHLCV alignment, prefix-only indicator calculations, short samples, gaps/holidays, raw splits, adjusted coverage, ranges, date navigation, marker callbacks, Drawer/tab preservation, StrictMode resizing/disposal and API failures. Browser checks used isolated fixtures at 1440 and 410 pixels: candles/lines, oscillator panels, basis changes, date navigation, Drawer return and no settled horizontal overflow. All fifteen personal application tables contained zero rows; the existing three migrations remain applied. No provider calls, package/schema/migration changes or application data inserts were required.

Existing nonblocking warnings: Vite's roughly 593 kB main chunk; jsdom's limited Ant Design CSS/pseudo-element support.
