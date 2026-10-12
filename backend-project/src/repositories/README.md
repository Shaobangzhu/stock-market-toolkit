# Repository boundary

Repositories receive a Prisma client or transaction client; services own workflows and transactions. `instruments.ts` handles identity and membership, and `prices.ts` handles explicit bar writes with Decimal strings. No repository runs on startup. Additional domain repositories belong with their feature phases. Never add seeds, JSON storage, or legacy imports. See `docs/DATABASE.md` at the repository root for schema and test contracts.
