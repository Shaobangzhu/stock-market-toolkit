# Provider boundary

`MarketDataProvider` and `TiingoMarketDataProvider` implement metadata, daily history and latest EOD observations. Inject validated `AppConfig`; never read `process.env` at module load. Keep credentials and adapter-owned URLs backend-only, validate provider responses, and use bounded requests with safe error codes. Provider requests occur only inside explicit sync actions. Twelve Data, SEC, and OpenAI remain later phases. See the root `docs/TIINGO.md` for precision, quotas, adjustment rebasing and calendar boundaries.
