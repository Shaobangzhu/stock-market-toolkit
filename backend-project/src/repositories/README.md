# Repository boundary

Place Prisma persistence implementations here when the fresh PostgreSQL schema is introduced. Repositories own database access and transactions; services own workflows. Do not implement JSON-file storage, seeds, or legacy data import. Phase 1 has no persistence or database connection.
