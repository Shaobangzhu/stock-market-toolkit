import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { defineConfig } from 'prisma/config';
import { parseDatabaseUrl } from './src/config/env.js';

dotenv.config({ path: fileURLToPath(new URL('./.env', import.meta.url)), quiet: true });

// Generation is offline. Commands connecting to PostgreSQL require DATABASE_URL.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: parseDatabaseUrl(process.env.DATABASE_URL) ?? '' },
});
