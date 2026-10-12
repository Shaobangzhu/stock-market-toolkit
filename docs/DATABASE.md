# Local PostgreSQL foundation

Implemented 2026-10-12. This document supersedes the database proposals in the original architecture audit. There are no application users, authentication tables, seeds, provider calls, or legacy imports.

## Installed configuration

| Component | Selection |
| --- | --- |
| Docker Compose project / service | `stock-research-lab` / `postgres` |
| Container | `srl-postgres` |
| Image | `postgres:18.6-bookworm` (stable, pinned patch) |
| Host endpoint | **127.0.0.1:5437** → container 5432 |
| Database | `stock_research_lab` |
| Application / migration role | `stock_research_user`; owns this database, **not** superuser, CREATEDB, or CREATEROLE |
| Container administration role | `srl_admin`; used only for bootstrap/local database administration and isolated test database creation |
| Persistent named volume | `srl-postgres-data`, mounted at `/var/lib/postgresql` (PostgreSQL 18 layout) |
| Dedicated bridge network | `srl-database`; not shared with existing projects |
| Prisma CLI, client, adapter | All **7.10.0**; `pg` **8.23.1** |
| Secrets | Existing `backend-project/.env` preserved; generated `backend-project/.env.postgres` ignored, mode 0600 |

Docker was already installed; its stopped desktop application was started. Inspection covered all containers, stopped-container port reservations, networks, volumes, and host listeners. Existing containers `ppi-local-postgres-1`, `psgi-postgresql`, `dgi-mongodb`, and `cpi-postgres` were left stopped and unchanged. Reserved PostgreSQL ports included 55435 and 5433; 5437 was unreserved and successfully bind-tested. Resource names above did not previously exist.

`internal: true` networks on this Docker setup suppressed host port publication. The project therefore uses its own ordinary bridge, with the published port explicitly restricted to loopback. No external project joins this network. Do not attach unrelated containers to it.

The image's first initialization creates a dedicated application database role using `docker/postgres/init-app.sql`; it reads passwords from container environment without embedding them in committed SQL. Only explicitly listed database variables enter the container; provider keys from `.env` do not. Docker administrators can inspect container credentials, so do not share full `docker inspect` or interpolated Compose output.

Official references: [PostgreSQL image versions and volume layout](https://github.com/docker-library/docs/blob/master/postgres/README.md), [Prisma PostgreSQL driver configuration](https://www.prisma.io/docs/orm/v7/core-concepts/supported-databases/postgresql), [Prisma client generator](https://www.prisma.io/docs/orm/v7/prisma-schema/overview/generators).

## Setup and normal operation

Commands below start at the repository root. Docker is already installed; start its existing application if the daemon is unavailable. On another computer, inspect resources **before** selecting a port or creating this project's resources:

```sh
docker ps -a --format '{{.Names}}\t{{.Image}}\t{{.Ports}}\t{{.Status}}'
docker ps -aq | xargs -r docker inspect --format '{{.Name}} {{json .HostConfig.PortBindings}}'
docker network ls
docker volume ls
lsof -nP -iTCP -sTCP:LISTEN
```

Also inspect stopped containers: their intended ports may not appear in `docker ps`'s Ports column. Choose different names/port if any project resource conflicts; never adopt someone else's volume. This machine has already been configured on 5437; **do not rerun bootstrap here**.

For a new checkout, install dependencies, copy the example only if `.env` does not exist, then explicitly initialize local secrets after verifying the chosen port:

```sh
cd backend-project
npm ci
test -e .env || cp .env.example .env
node scripts/configure-database.mjs 5437
cd ..
docker compose --env-file backend-project/.env.postgres up -d --wait postgres
cd backend-project
npm run db:validate
npm run db:migrate
npm run build
npm start
```

`configure-database.mjs` refuses to replace an existing `.env.postgres`, preserves existing `.env` credentials/provider settings, and only fills an absent/blank DATABASE_URL. If an existing URL targets a different database/port, it fails without modifying either file. Never commit either local environment file. URL passwords must be percent-encoded when manually edited. DATABASE_URL accepts local hosts and the optional `schema=public` query only; query overrides such as `host=...` are rejected.

Subsequent startup uses `docker compose ... up -d --wait postgres`, `npm run db:migrate`, and `npm start` after a build. Migrations are explicit; backend startup does not run them or insert data. Generate the ignored client with `npm run db:generate`; build/typecheck also generate it. `prisma.config.ts` loads the backend-relative `.env` quietly before reading and validating DATABASE_URL. No cloud/Accelerate URL is used.

From the repository root:

```sh
docker compose --env-file backend-project/.env.postgres ps
docker compose --env-file backend-project/.env.postgres stop postgres
docker compose --env-file backend-project/.env.postgres start --wait postgres
docker compose --env-file backend-project/.env.postgres restart postgres
```

Stop/restart only this service. Do not use volume deletion, volume pruning, or reset commands. PostgreSQL major upgrades need a separately tested dump/restore or pg_upgrade plan; changing the image major against this volume is not an upgrade procedure.

## Schema contracts

The source of truth is `backend-project/prisma/schema.prisma` plus reviewed SQL migrations. All **13** application tables begin empty. Enums are schema objects, not seeded lookup rows.

| Entity | Important boundaries |
| --- | --- |
| `Issuer` | Unique padded 10-digit CIK; shared by multiple listings. |
| `Instrument` | Unique **(symbol, exchange)**; uppercase canonical identity, currency, valid exchange timezone, optional issuer. Symbol alone is not an unambiguous identifier. |
| `WatchlistEntry` | Unique instrument; deleting membership retains instrument/history. |
| `PriceBar` | Unique instrument/provider/interval/adjustment/timestamp; date, currency, timezone, retrieval instant, content hash and revision retained. Raw/split/total-return series are separate records. |
| `SecFiling` | Unique accession; issuer, form, filing date, optional acceptance instant/reporting period, document URL, amendment flag. |
| `CompanyFact` | Exact value with taxonomy/concept/unit/context and instant/duration periods. Filing accession distinguishes restatements. Composite FK prevents assigning a filing to the wrong issuer. No separate FundamentalSnapshot table is needed. |
| `ProviderSyncJob` | Explicit job request snapshot, unique idempotency key, status, attempts, heartbeat, retry deadline, safe error code; no raw upstream errors/secrets. |
| `ProviderSyncState` | Unique instrument/provider/dataset/scope; last attempt/success/failure, coverage, fresh-through, retry eligibility. A failure need not erase previous success. |
| `ResearchRun` | Versioned series, immutable inputs/hash/cutoff/model/prompt/output schema. Completed/failed/interrupted runs cannot be overwritten or deleted. |
| `ResearchSource` | Run-scoped citation identity, URL, publication/retrieval instants and evidence snapshot. Add sources before completing the run in one transaction; finalized source sets are immutable. |
| `ResearchNote` | Append-only stock-scoped note versions, optionally attached to a matching stock's research run. |
| `EntryScenario` | Append-only versioned method/assumptions/input/result snapshots, exact optional price bounds. No financial formula is implemented. |
| `AppPreference` | Sparse nonsecret JSON overrides with schema version; no default row. Future API must allowlist keys and validate value schemas. |

Prices use `numeric(24,8)` (16 integer digits), volumes `numeric(30,8)` (22 integer digits; RAW restricted to integers), facts `numeric(38,12)` (26 integer digits). `exactDecimal` accepts plain decimal **strings**, rejecting JavaScript numbers, exponents, nonfinite values, and excess scale/precision. Repositories and future provider normalization must use this path for exact values. Monetary values inside JSON snapshots must also remain strings; JSON alone cannot enforce that contract. `serializePriceBar` emits decimals as strings and dates deliberately. Provider fixture validation must confirm these bounds before imports are implemented.

Instants use `timestamptz(3)` and the connection timezone is UTC. Session/reporting dates use PostgreSQL `date`. A DAY bar's timestamp is the trading date at 00:00 UTC **as a canonical date key**, not an exchange open/close instant. Intraday intervals are reserved in the schema but provider support is not implemented. Never infer historical availability from a date-only filing without acceptance time.

SQL adds checks for coherent positive OHLC, nonnegative/integer raw volume, finite decimals, reporting periods, daily date identity, currency/hash formats, valid timezone names, version numbers and terminal job states. Foreign keys restrict destructive deletion. Indexes cover price series, instrument/date history, issuer/report periods, status queues, research history and foreign keys. Triggers preserve saved research/source/note/scenario history; changing a saved result requires a new version.

Only instrument/watchlist and price repository foundations are implemented. Workflows, provider-specific symbol mappings, worker claim/concurrency policy, full research/fundamental repositories, supported metrics, retention, and entry methodology belong to later phases. `priceRepository.save` upserts one current observation and increments its revision on each explicit write; it is not a full point-in-time price archive.

## Migration and validation

Initial migration: **`20261012000100_initial_foundation`**. The SQL was generated from an empty schema and augmented with reviewed checks/triggers; it contains no domain inserts. It was applied using `prisma migrate deploy`. Do not edit applied migrations; add a new migration for future changes. Never use `migrate reset` or `db push` on the personal database. For development generation, use a separate disposable database/shadow database, or review `migrate diff` SQL before applying it. Custom checks/triggers must be retained explicitly because Prisma schema diff does not model them.

From `backend-project/`:

```sh
npm run db:status
npm run db:verify -- --expect-empty
npm test
npm run test:integration
# Explicitly also restart this project's container during persistence validation:
npm run test:integration -- --restart
```

The integration runner verifies the exact Compose project/service and loopback mapping before creating a cryptographically random `srl_test_<24 hex>` database. It replays the migration from empty, runs repository/constraint tests, and drops **only the database created by that invocation**. It never resets or inserts fixtures into `stock_research_lab`. If creation fails because a name exists, cleanup does not run. Test cases use rolled-back transactions. The optional restart check persists a test-only marker, closes its client, restarts `srl-postgres`, reconnects and verifies the marker before test-database cleanup.

`GET /api/health` is liveness. `GET /api/ready` returns 200 only when the database connection and all application tables are accessible; otherwise 503 with `DATABASE_UNAVAILABLE`. Readiness performs no writes and reveals no connection URL or driver error. One lazy Prisma/pg pool serves the backend (max 5 connections; 2-second connect timeout, 3-second statement timeout, 4-second query timeout). SIGINT/SIGTERM close HTTP first, disconnect Prisma, and enforce a 10-second shutdown deadline. Missing database configuration leaves liveness working and readiness unavailable.

## Safe backup and restore

Run backups from the repository root. The following creates a new private dump and refuses to overwrite an existing path:

```sh
mkdir -p backups
backup_file="backups/stock-research-lab-$(date -u +%Y%m%dT%H%M%SZ).dump"
(umask 077; set -C; docker exec srl-postgres pg_dump -U stock_research_user -d stock_research_lab --format=custom > "$backup_file")
```

Check the command exit status. A failed command can leave a partial file; do not treat it as a usable backup. Dumps are ignored by Git and can contain private research. Protect/store them intentionally. The named volume provides restart persistence, not an independent backup.

Restore to a **new separate database**, never over the personal database. Set `backup_file` to the intended existing dump; inspect its contents first. Creation must succeed before restore runs:

```sh
docker exec -i srl-postgres pg_restore --list < "$backup_file"
restore_db="srl_restore_$(date -u +%Y%m%d_%H%M%S)"
docker exec srl-postgres createdb -U srl_admin -O stock_research_user "$restore_db" &&
  docker exec -i srl-postgres pg_restore -U stock_research_user -d "$restore_db" --no-owner --no-acl --exit-on-error --single-transaction < "$backup_file"
```

Inspect restored counts and `_prisma_migrations` in that database before considering any cutover. Do not replace `.env`, remove the original database, or delete volumes as part of restore testing. Restore only trusted dumps. The general backup/restore procedure is documented; a populated real-data restore is not yet exercised in this empty-foundation phase.

## Troubleshooting and remaining limits

- Daemon unavailable: start the already-installed Docker application and check `docker context ls`. Do not reinstall it or change other projects.
- Port conflict: inspect stopped-container reservations and host listeners again. Change this project's ignored `SRL_POSTGRES_PORT` and matching DATABASE_URL together, then recreate only its service; retain the volume.
- Existing volume ignores new credentials: image initialization runs only once. Changing `.env` does not rotate the PostgreSQL role password. Plan an explicit role-password change and update local configuration together; never delete the volume to fix credentials.
- Initialization interruption: check sanitized project logs and the actual role/database state before acting. This implementation recovered a failed shell-script bootstrap using the committed SQL file, without resetting the initialized volume. Never rerun role creation blindly against an existing database.
- Readiness 503: check `docker compose ... ps`, `npm run db:status`, backend-relative DATABASE_URL, role credentials and matching port. Liveness success alone does not prove database readiness.
- Migration failure: inspect Prisma status and review the failed SQL; do not mark it applied or reset data blindly. New migrations should preserve existing reports.
- Decimal errors: pass exact strings within declared precision. Do not round silently or convert large volumes through `Number`.
- Test cleanup interrupted: a random `srl_test_...` database may remain. Inspect its identity and ownership before deciding on manual cleanup; no broad drop/reset script is provided.
- Dependency overrides: Prisma 7.10.0 ships older transitive packages. `mysql2` is pinned to patched 3.24.5, and `@prisma/config` uses `deepmerge-ts` 8.0.0 to resolve recursive-graph stack exhaustion. The [upstream 8.0.0 changes](https://github.com/RebeccaStevens/deepmerge-ts/releases/tag/v8.0.0) were reviewed: this project uses ordinary configuration objects, not changed Map/custom-merge APIs. Clean install, CLI config loading/generation, fresh migration replay and tests pass with both overrides. Full and production-only npm audits report zero vulnerabilities. Reassess these temporary overrides when updating Prisma.
- Frontend integration, market-data ingestion, SEC selection, AI research, and entry-price methods remain unimplemented. No authentication or sample data has been added.

## Verification record and changed files

See [DATABASE_VALIDATION.md](DATABASE_VALIDATION.md) for exact commands, final status/counts, test results, and changed paths.
