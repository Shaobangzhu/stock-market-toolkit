# Provider boundary

Place Tiingo, Twelve Data, SEC, and OpenAI adapters here in later phases. Inject validated `AppConfig`; never read `process.env` at module load. Keep credentials and adapter-owned URLs backend-only, validate provider responses, and use bounded requests with safe error codes. No adapters or provider calls run in Phase 1.
