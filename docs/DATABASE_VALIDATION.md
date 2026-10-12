# Database implementation validation

Validated 2026-10-12. The application database is `stock_research_lab` on `127.0.0.1:5437`; PostgreSQL 18.6 is healthy in `srl-postgres`. Existing Docker resources were inspected before creation. No unrelated container, database, network or volume was modified; no legacy data was read/imported by the implementation.

## Exact migration status

`prisma migrate status`: **1 migration found; database schema is up to date**.

| Migration | Applied | Rolled back | Pending |
| --- | --- | --- | --- |
| `20261012000100_initial_foundation` | Yes; finished successfully | No | No |

The migration also applied successfully to independently created empty test databases. SQL checks/triggers and unique/foreign-key constraints were exercised against PostgreSQL, not mocked.

Final row counts, after migration, container restart, integration tests and live backend health/readiness requests:

| Application table | Rows |
| --- | ---: |
| Instrument | 0 |
| Issuer | 0 |
| WatchlistEntry | 0 |
| PriceBar | 0 |
| CompanyFact | 0 |
| SecFiling | 0 |
| ProviderSyncJob | 0 |
| ProviderSyncState | 0 |
| ResearchRun | 0 |
| ResearchSource | 0 |
| ResearchNote | 0 |
| EntryScenario | 0 |
| AppPreference | 0 |

**13 application tables, 0 total rows.** `_prisma_migrations` contains one infrastructure migration record. No seed command exists. Temporary fixtures remained in random test databases; those databases were removed after each successful test invocation.

## Executed commands and results

Inspection/selection, from the repository root:

```sh
git status --short
docker version --format '{{.Server.Version}}'
docker context ls
open -a Docker
docker ps -a --format '{{.Names}}\t{{.Image}}\t{{.Ports}}\t{{.Status}}'
docker network ls
docker volume ls
docker ps -aq | xargs -r docker inspect --format '{{.Name}} ports={{json .HostConfig.PortBindings}} networks={{json .NetworkSettings.Networks}} mounts={{range .Mounts}}{{.Name}}:{{.Destination}} {{end}}'
lsof -nP -iTCP -sTCP:LISTEN
```

An inline Node `net.createServer()` bound and released `127.0.0.1:5437` successfully. Environment inspection printed only URL host/port/database/role and whether a password existed. Passwords/API keys were not printed. Docker inspection output deliberately excluded environment variables. The first daemon check failed because Docker was stopped; starting the existing application resolved it.

Dependency and schema commands, from `backend-project/`:

```sh
npm view prisma version engines
npm view prisma@7.10.0 engines
npm view @prisma/client version
npm view @prisma/adapter-pg version
npm view pg version
npm install --save-exact @prisma/client@7.10.0 @prisma/adapter-pg@7.10.0 pg@8.23.1
npm install --save-dev --save-exact prisma@7.10.0 @types/pg
node scripts/configure-database.mjs 5437
npx prisma format
npx prisma validate
npx prisma generate
npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script --output prisma/migrations/20261012000100_initial_foundation/migration.sql
```

Reviewed checks/triggers were added to the initial SQL before its first application. Stable Prisma 7.10.0 was selected; the registry's latest CLI tag pointed to an 8.0 release candidate. Dependency advisories were investigated with `npm audit --json`, `npm ls`, and package metadata; scoped patched overrides are explained in [DATABASE.md](DATABASE.md).

Provisioning/recovery, from the repository root (database migration commands run from `backend-project/`):

```sh
docker compose --env-file backend-project/.env.postgres up -d --wait postgres
docker exec srl-postgres psql -U srl_admin -d stock_research_lab -v ON_ERROR_STOP=1 -f /docker-entrypoint-initdb.d/10-app.sql
docker port srl-postgres
# backend-project working directory:
npx prisma migrate deploy
npx prisma migrate status
```

The initial shell bootstrap could not execute through this host's bind mount. It was replaced with a SQL bootstrap and run against the new database without deleting the initialized volume. An internal bridge suppressed the host mapping; the project network was corrected and only its container/network recreated. Final mapping is `5432/tcp -> 127.0.0.1:5437`. The SQL recovery command is a historical operation, **not** a routine startup command.

Final checks, from `backend-project/`:

```sh
npm install --package-lock-only --ignore-scripts
npm ci
npm audit
npm audit --omit=dev
npm test
npm run test:integration
npm run test:integration -- --restart
npm run db:verify -- --expect-empty
node scripts/verify-database.mjs --expect-empty
npm run db:status
```

- Clean install and TypeScript production build pass. Each build also generates Prisma Client successfully.
- **46 backend tests pass**, including configuration rejection/redaction, local HTTP boundaries, readiness and exact-decimal handling.
- **6 PostgreSQL integration tests pass**, covering empty initialization/indexes/role privileges, composite identity, foreign keys, membership retention, exact price/volume/fact round trips, unique price series, invalid OHLCV/date rejection, SEC issuer consistency, immutable research/notes/scenarios/citations, and sync failure/freshness/idempotency constraints.
- Fresh migration replay succeeds on each isolated test database.
- Restart mode persisted a test-only instrument across `docker restart srl-postgres`, reconnected successfully and cleaned up only its own temporary database. No fixture entered the personal database.
- Final dependency graph: **0 npm audit vulnerabilities**, both full and production-only. CLI generation and fresh migration replay were repeated after applying dependency overrides.
- Inline compiled-server smoke check bound an ephemeral loopback HTTP port, obtained **200** from `/api/health` and `/api/ready`, sent SIGTERM, and observed **exit 0**. Captured stdout/stderr contained no configured API key, database URL or password. A real refused database connection returned unavailable without driver-error exposure.
- `git diff --check` passes; `git check-ignore` confirms `.env`, `.env.postgres` and generated Prisma source are ignored. Final Docker listing confirms all four unrelated containers remained stopped.

The restart check preceded the final tooling-only dependency override; database/runtime packages and schema were unchanged by that override. A fresh migration and all repository tests passed afterward. No populated real-data backup restore, provider call, frontend test or frontend modification was performed.

## Files inspected before implementation

`AGENTS.md`, `docs/PRODUCT_SCOPE.md`, `docs/ARCHITECTURE.md`, `docs/IMPLEMENTATION_PLAN.md`, `.gitignore`, `README.md`, backend `README.md`, `package.json`, `.env.example`, `tsconfig.json`, `src/config/env.ts`, `src/app.ts`, `src/index.ts`, `src/routes/index.ts`, `src/routes/health.ts`, `src/middleware/error-handler.ts`, `src/utils/http-error.ts`, `src/utils/logger.ts`, `src/repositories/README.md`, and existing `test/config.test.mjs`, `test/http.test.mjs`, `test/startup.test.mjs`. Existing `.env` was parsed privately for database setup; its contents were not displayed or replaced. Prisma generator/config/adapter definitions and installed dependency paths were inspected for compatibility.

## Changed files

All paths below are relative to the repository root:

```text
.gitignore
README.md
compose.yaml
docker/postgres/init-app.sql
docs/ARCHITECTURE.md
docs/IMPLEMENTATION_PLAN.md
docs/DATABASE.md
docs/DATABASE_VALIDATION.md
backend-project/.env.example
backend-project/README.md
backend-project/package.json
backend-project/package-lock.json
backend-project/prisma.config.ts
backend-project/prisma/schema.prisma
backend-project/prisma/migrations/migration_lock.toml
backend-project/prisma/migrations/20261012000100_initial_foundation/migration.sql
backend-project/scripts/configure-database.mjs
backend-project/scripts/test-database.mjs
backend-project/scripts/verify-database.mjs
backend-project/src/app.ts
backend-project/src/config/env.ts
backend-project/src/index.ts
backend-project/src/repositories/README.md
backend-project/src/repositories/instruments.ts
backend-project/src/repositories/prices.ts
backend-project/src/routes/index.ts
backend-project/src/routes/ready.ts
backend-project/src/services/database.ts
backend-project/src/utils/decimal.ts
backend-project/src/utils/http-error.ts
backend-project/test/config.test.mjs
backend-project/test/decimal.test.mjs
backend-project/test/http.test.mjs
backend-project/test/integration/database.test.mjs
```

Ignored local output: newly created `backend-project/.env.postgres`, generated `src/generated/prisma/`, `dist/` and installed dependencies. Existing `.env` was preserved. No commit or Git-history rewrite was performed.
