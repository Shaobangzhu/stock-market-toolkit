import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { AppConfig } from '../config/env.js';
import type { RequestBudget } from '../providers/tiingo.js';
import { ProviderError } from '../providers/market-data.js';

export function providerBudget(db: PrismaClient, config: AppConfig, now = () => new Date()): RequestBudget {
  return {
    async reserve(symbol, bytes) {
      return db.$transaction(async (tx) => {
        // Serialize admission across processes; token values never enter the DB.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(70011201)`;
        const current = now();
        const recent = await tx.providerRequestUsage.findMany({ where: { provider: 'TIINGO', requestedAt: { gt: new Date(current.getTime() - 31 * 86400000) } }, orderBy: { requestedAt: 'asc' } });
        const cooldown = recent.reduce<Date | undefined>((value, row) => row.retryAfter && (!value || row.retryAfter > value) ? row.retryAfter : value, undefined);
        if (cooldown && cooldown > current) throw new ProviderError(429, 'PROVIDER_RATE_LIMITED', 'Tiingo requests are paused until the provider cooldown expires.', cooldown);
        const hour = recent.filter((row) => row.requestedAt.getTime() > current.getTime() - 3600000);
        const day = recent.filter((row) => row.requestedAt.getTime() > current.getTime() - 86400000);
        const symbols = new Set(recent.map((row) => row.symbol));
        let retryAfter: Date | undefined;
        if (hour.length >= config.TIINGO_MAX_REQUESTS_PER_HOUR) retryAfter = new Date(hour[0]!.requestedAt.getTime() + 3600000);
        if (day.length >= config.TIINGO_MAX_REQUESTS_PER_DAY) retryAfter = new Date(day[0]!.requestedAt.getTime() + 86400000);
        if ((!symbols.has(symbol) && symbols.size >= config.TIINGO_MAX_SYMBOLS_PER_MONTH)
          || recent.reduce((sum, row) => sum + row.responseBytes, 0n) + BigInt(bytes) > BigInt(config.TIINGO_MAX_BYTES_PER_MONTH)) {
          retryAfter = new Date(recent[0]!.requestedAt.getTime() + 31 * 86400000);
        }
        if (retryAfter) throw new ProviderError(429, 'PROVIDER_RATE_LIMITED', 'The configured local Tiingo usage budget has been reached.', retryAfter);
        const id = randomUUID();
        await tx.providerRequestUsage.create({ data: { id, provider: 'TIINGO', symbol, requestedAt: current, responseBytes: BigInt(bytes) } });
        return id;
      });
    },
    async complete(id, bytes, errorCode, retryAfter) {
      await db.providerRequestUsage.update({ where: { id }, data: { responseBytes: BigInt(bytes), errorCode: errorCode ?? null, retryAfter: retryAfter ?? null } });
    },
  };
}
