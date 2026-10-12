import { loadConfig } from '../dist/config/env.js';
import { createDatabase } from '../dist/services/database.js';

const database = createDatabase(loadConfig());
try {
  if (!database || !await database.ready()) throw new Error('not-ready');
  const tables = await database.client.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' ORDER BY tablename`;
  let rows = 0;
  for (const { tablename } of tables) {
    // Names originate in PostgreSQL's catalog; still quote identifiers explicitly.
    const quoted = `"${tablename.replaceAll('"', '""')}"`;
    const [{ count }] = await database.client.$queryRawUnsafe(`SELECT count(*)::text AS count FROM public.${quoted}`);
    console.log(`${tablename}: ${count}`);
    rows += Number(count);
  }
  console.log(`Application tables: ${tables.length}; total rows: ${rows}`);
  const migrations = await database.client.$queryRaw`SELECT migration_name, finished_at IS NOT NULL AS applied, rolled_back_at IS NOT NULL AS rolled_back FROM _prisma_migrations ORDER BY started_at`;
  console.log(JSON.stringify({ migrations }));
  if (process.argv.includes('--expect-empty') && rows !== 0) throw new Error('not-empty');
} catch {
  console.error('Database verification failed; check local startup, migrations, and expected row counts.');
  process.exitCode = 1;
} finally {
  await database?.close();
}
