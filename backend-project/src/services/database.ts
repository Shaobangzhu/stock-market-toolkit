import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import type { AppConfig } from '../config/env.js';

export interface DatabaseHealth {
  ready(): Promise<boolean>;
}

export function createDatabase(config: Pick<AppConfig, 'DATABASE_URL'>) {
  if (!config.DATABASE_URL) return undefined;
  // Exactly one lazy pool per server process, no queries or writes on construction.
  const adapter = new PrismaPg({
    connectionString: config.DATABASE_URL,
    max: 5,
    connectionTimeoutMillis: 2_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 3_000,
    query_timeout: 4_000,
    application_name: 'stock-research-lab',
    options: '-c timezone=UTC',
  });
  const client = new PrismaClient({ adapter, log: [], errorFormat: 'minimal' });
  return {
    client,
    async ready(): Promise<boolean> {
      try {
        // Verifies credentials, connection, and all application tables, without writes.
        // LIMIT 0 validates schema accessibility without scanning domain data.
        await client.$queryRaw`SELECT 1 FROM "Instrument", "Issuer", "WatchlistEntry",
          "PriceBar", "CompanyFact", "SecFiling", "ProviderSyncJob", "ProviderSyncState",
          "ResearchRun", "ResearchSource", "ResearchNote", "EntryScenario", "AppPreference" LIMIT 0`;
        return true;
      } catch {
        return false; // Never expose connection details, SQL, or underlying exceptions.
      }
    },
    async close(): Promise<void> {
      await client.$disconnect(); // Adapter owns and ends its pg pool.
    },
  };
}
