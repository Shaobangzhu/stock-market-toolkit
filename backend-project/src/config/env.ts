import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
const optionalText = z.preprocess(
  (value) => typeof value === 'string' && value.trim() === '' ? undefined : value,
  z.string().trim().min(1).optional(),
);

const frontendOrigin = z.string().refine((value) => {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' && localHosts.has(url.hostname)
      && !url.username && !url.password && value === url.origin;
  } catch {
    return false;
  }
}, 'Must be a local HTTP origin without credentials, path, query, or fragment');

const databaseUrl = optionalText.refine((value) => {
  if (value === undefined) return true; // Liveness works; readiness reports 503 until configured.
  try {
    const url = new URL(value);
    return ['postgresql:', 'postgres:'].includes(url.protocol)
      && localHosts.has(url.hostname) && url.pathname.length > 1
      && !!url.username && !!url.password && !url.hash
      // pg accepts query parameters overriding the URL host/database. Disallow
      // these so a URL which looks local cannot connect to an external server.
      && [...url.searchParams.keys()].every((key) => key === 'schema')
      && (url.searchParams.get('schema') === null || url.searchParams.get('schema') === 'public');
  } catch {
    return false;
  }
}, 'Must be a local PostgreSQL connection URL');

export const marketDataProviderSchema = z.enum(['tiingo', 'twelve_data']);
export type MarketDataProvider = z.infer<typeof marketDataProviderSchema>;

export const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.literal('127.0.0.1').default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(7001),
  FRONTEND_ORIGIN: frontendOrigin.default('http://localhost:5173'),
  DATABASE_URL: databaseUrl,
  TIINGO_API_KEY: optionalText,
  TWELVE_DATA_API_KEY: optionalText,
  PRIMARY_MARKET_DATA_PROVIDER: marketDataProviderSchema.default('tiingo'),
  FALLBACK_MARKET_DATA_PROVIDER: marketDataProviderSchema.default('twelve_data'),
  OPENAI_API_KEY: optionalText,
  OPENAI_MODEL: z.string().trim().min(1).max(128).default('gpt-5-mini'),
  SEC_EDGAR_USER_AGENT: optionalText.refine(
    (value) => value === undefined || (/^[\x20-\x7E]+$/.test(value)
      && /\S+@\S+\.\S+/.test(value)),
    'Must include a contact email and contain no control characters',
  ),
  SEC_EDGAR_MAX_RPS: z.coerce.number().int().min(1).max(10).default(2),
}).refine(
  (config) => config.PRIMARY_MARKET_DATA_PROVIDER !== config.FALLBACK_MARKET_DATA_PROVIDER,
  { path: ['FALLBACK_MARKET_DATA_PROVIDER'], message: 'Must differ from the primary provider' },
);

export type AppConfig = Readonly<z.infer<typeof configSchema>>;

export class ConfigError extends Error {
  constructor(public readonly fields: readonly string[]) {
    super(`Invalid configuration fields: ${fields.join(', ')}`);
    this.name = 'ConfigError';
  }
}

export function parseDatabaseUrl(value: unknown): string | undefined {
  const result = databaseUrl.safeParse(value);
  if (!result.success) throw new ConfigError(['DATABASE_URL']);
  return result.data;
}

export function parseConfig(environment: Record<string, unknown>): AppConfig {
  const result = configSchema.safeParse(environment);
  if (!result.success) {
    // Never include Zod's issue messages/inputs or the environment in diagnostics.
    throw new ConfigError([...new Set(result.error.issues.map(
      (issue) => String(issue.path[0] ?? 'configuration'),
    ))]);
  }
  return Object.freeze(result.data);
}

export function loadConfig(): AppConfig {
  const result = dotenv.config({
    path: fileURLToPath(new URL('../../.env', import.meta.url)),
    override: false,
    quiet: true,
  });
  if (result.error && (result.error as NodeJS.ErrnoException).code !== 'ENOENT') {
    throw new ConfigError(['.env']);
  }
  return parseConfig(process.env);
}
