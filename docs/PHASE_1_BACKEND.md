# Phase 1 — Express backend refactor

Implements the user's backend-only Phase 1 request. The earlier architecture audit is historical; the frontend, PostgreSQL/Prisma, domain APIs, data adapters, jobs, and research remain later work.

## Result

- Removed backend authentication, all login/logout/login-status routes, signed cookies, hardcoded password/signing secret, route decorators, Alpha Vantage fetchers, JSON storage, and legacy data routes.
- Removed all 19 tracked obsolete build files, including the credential-looking key file, and both legacy data files. No legacy migration, backup, Git-history rewrite, or credential test was performed. Deleting the key file does not establish that the old provider key has been revoked.
- Replaced the global side-effect Router with explicit factory-built Router modules before changing the compiler target. `app.ts` constructs the app without listening; `index.ts` loads validated configuration, starts on loopback, and handles shutdown/listen failures.
- Runtime dependencies are Express 5.3.0, Zod 4.6.6, and dotenv 18.0.7. Build tooling is TypeScript 5.9.3, tsx 4.23.15, Express types 5.0.6, and Node types 24.19.2. ESM/NodeNext targets ES2023, with strict checking, no decorator metadata, and clean generated output in ignored `dist/`.
- Supported Node engines are 22.12+ within Node 22 and Node 24; `.node-version` selects 24. Actual integration/build execution used Node 22.12.0 / npm 10.9.0. The earlier environment/version inspection reported Node 24.19.0 / npm 11.17.0; full Node 24 HTTP execution was not independently verified in this phase.
- Quiet dotenv loading resolves `backend-project/.env` relative to the config module before any configuration is consumed. Process variables override local-file values. The existing `.env` is byte-for-byte preserved, ignored, and untracked. Missing provider credentials, database URL, or SEC User-Agent allow Phase 1 startup; nonempty invalid configuration fails with field-name-only diagnostics.
- `GET /api/health` returns 200 liveness with no provider/database calls, secrets, auth, or data writes. The requested unversioned health path is intentional; future domain APIs can use `/api/v1`.
- Built-in bounded Express JSON/urlencoded parsers, reusable Zod request validation, and centralized errors produce 400/403/404/405/413/415/500 as appropriate. Express 5 async failures are handled centrally. Unknown exception messages and parser inputs are never returned/logged.
- Local middleware checks Host, exact configured frontend or backend Origin, Fetch Metadata, preflight methods/headers, and mutation proof. Only the configured frontend receives CORS headers; no wildcard or credentialed CORS. Mutations require allowed Origin, `Content-Type: application/json`, and `X-Stock-Research-Lab: 1`.
- Services/repositories/providers boundaries exist without synthetic data or premature provider/database implementations. No application database was created and no tables were seeded.

## Commands and verification

Relevant commands were run from `backend-project/` unless noted:

```sh
node --version
npm --version
npm view express version
npm view zod version
npm view typescript@5.9.3 version
npm view @types/express version
npm view @types/node@24 version --json
npm view tsx version
npm view dotenv version
npm install --ignore-scripts --no-audit --no-fund --fetch-retries=0 --fetch-timeout=20000
npm install --package-lock-only --ignore-scripts --no-audit --no-fund --offline
npm ci --ignore-scripts --no-audit --no-fund --offline
npm run typecheck
npm run build
npm test
npm audit --json --fetch-retries=0 --fetch-timeout=20000
npm start
npm run dev
curl --fail --silent --show-error http://127.0.0.1:7001/api/health
curl --silent --show-error --write-out '\nHTTP %{http_code}\n' http://127.0.0.1:7001/api/isLogin
git diff --check
git check-ignore backend-project/.env backend-project/dist/index.js
```

Metadata queries used finite fetch timeouts; an initial sandboxed npm query was interrupted after failing to produce output. The first sandboxed HTTP test run failed because socket binding was denied. The authorized loopback run exposed two test-client framing/reuse mistakes, which were corrected with explicit Content-Length and isolated connections. Compiler checks also caught two leftover barrel files, which were removed. A sandboxed tsx version probe could not open its IPC pipe; actual `npm run dev` was subsequently verified with local socket access.

Final results:

| Check | Result |
| --- | --- |
| Clean offline lockfile installation | Passed; legacy direct dependencies removed. Express retains its own internal parser dependency. |
| Typecheck and clean build | Passed. |
| Final test suite after clean install | **41 passed, 0 failed, 0 skipped.** |
| Health and route removal | Passed: no-cookie 200 health; removed auth/data routes return JSON 404. |
| Config and dotenv | Passed: defaults, invalid values, field-only diagnostics, local-file loading before validation, process overrides. Synthetic `.env` fixtures were isolated in temporary directories. |
| HTTP protection/errors | Passed: CORS/preflight/Host/Origin checks, every mutation method, missing proof, malformed JSON, invalid query/path/body, oversized/encoded bodies, synchronous/asynchronous errors. |
| Secret omission | Passed: synthetic secret-bearing errors, request inputs/URLs, and extra log fields do not appear in responses/logs. Actual startup/404 logs contained safe metadata only. |
| Compiled process lifecycle | Passed: no optional credentials required, health response, SIGTERM shutdown, configuration exit 1, occupied-port safe exit 1. |
| Existing local configuration smoke test | `npm start` returned 200 health and 404 login-status using the unchanged `.env`; process stopped after checks. |
| Watch command | `npm run dev` successfully started on 127.0.0.1:7001; watcher stopped after verification. |
| npm advisory scan | **0 vulnerabilities** in the resolved backend graph at verification time. |
| Whitespace, legacy-code scan, secret-file preservation/ignore | Passed. No frontend source/lockfile modifications. |

No test contacts a real market/SEC/OpenAI provider or uses the personal database. HTTP tests compose fixture-only routes with the production app factory and run against disposable loopback listeners. No fixture route is mounted by the production entrypoint.

## Exact changed paths

Modified:

```text
README.md
docs/ARCHITECTURE.md
docs/IMPLEMENTATION_PLAN.md
backend-project/.env.example
backend-project/package.json
backend-project/package-lock.json
backend-project/tsconfig.json
backend-project/src/index.ts
```

Added:

```text
docs/PHASE_1_BACKEND.md
backend-project/.node-version
backend-project/README.md
backend-project/scripts/clean.mjs
backend-project/src/app.ts
backend-project/src/config/env.ts
backend-project/src/middleware/error-handler.ts
backend-project/src/middleware/local-access.ts
backend-project/src/middleware/request-context.ts
backend-project/src/middleware/validate-request.ts
backend-project/src/providers/README.md
backend-project/src/repositories/README.md
backend-project/src/routes/health.ts
backend-project/src/routes/index.ts
backend-project/src/services/health.ts
backend-project/src/utils/http-error.ts
backend-project/src/utils/logger.ts
backend-project/test/config.test.mjs
backend-project/test/http.test.mjs
backend-project/test/startup.test.mjs
```

Deleted:

```text
backend-project/build/constants.js
backend-project/build/controller/LoginController.js
backend-project/build/controller/covered-call-controller.js
backend-project/build/controller/decorator.js
backend-project/build/controller/index.js
backend-project/build/controller/login-controller.js
backend-project/build/controller/stock-data-controller.js
backend-project/build/decorator/controller.js
backend-project/build/decorator/index.js
backend-project/build/decorator/methods.js
backend-project/build/decorator/request.js
backend-project/build/decorator/use.js
backend-project/build/enums/methods.js
backend-project/build/index.js
backend-project/build/interfaces/request-with-body.js
backend-project/build/router.js
backend-project/build/utils/constants.js
backend-project/build/utils/stockPriceFetcher.js
backend-project/build/utils/util.js
backend-project/data/prices.json
backend-project/data/volume.json
backend-project/src/controller/index.ts
backend-project/src/controller/login-controller.ts
backend-project/src/controller/stock-data-controller.ts
backend-project/src/decorator/controller.ts
backend-project/src/decorator/index.ts
backend-project/src/decorator/request.ts
backend-project/src/decorator/use.ts
backend-project/src/enums/methods.ts
backend-project/src/interfaces/request-with-body.ts
backend-project/src/router.ts
backend-project/src/utils/constants.ts
backend-project/src/utils/singleStockHourlyVolumeFetcher.ts
backend-project/src/utils/stockPriceFetcher.ts
backend-project/src/utils/util.ts
```

Generated `dist/` and installed `node_modules/` are ignored outputs, not deliverable source. Existing `.env` was not modified.

## Remaining limitations

- Backend Phase 1 is complete; the broader plan's frontend/Vite work is still pending. Existing frontend auth/JSON-data requests no longer work with this backend.
- Health is liveness only. There is no PostgreSQL/Prisma schema, readiness check, watchlist API, market-data import, paid research, or persistence yet.
- Provider settings are validated configuration only. Credentials/entitlements, actual SEC contact, OpenAI model/tool capability, quotas, and database connectivity have not been checked.
- Mutation protection is installed and tested using isolated fixture routes; production currently exposes no mutation endpoint. Future UI calls must send the documented Origin/header/JSON combination and future proxy configuration must forward the expected backend Host.
- Logs intentionally omit raw exception details; future observability must retain redaction. Local request defenses assume a trusted OS account and do not secure remote/multi-user operation.
- Deleted historical credentials may still exist in Git history; revocation remains an owner follow-up. This phase performs no history rewrite.
