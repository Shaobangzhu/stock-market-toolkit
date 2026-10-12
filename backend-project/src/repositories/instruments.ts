import { z } from 'zod';
import type { Prisma } from '../generated/prisma/client.js';

const identity = z.object({
  symbol: z.string().trim().min(1).max(32).transform((value) => value.toUpperCase()),
  exchange: z.string().trim().min(1).max(32).transform((value) => value.toUpperCase()),
});
const instrumentInput = identity.extend({
  name: z.string().trim().min(1).max(256),
  currency: z.string().regex(/^[A-Z]{3}$/),
  exchangeTimezone: z.string().max(64).refine((value) => {
    try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; }
  }),
}).strict();

export function instrumentRepository(db: Prisma.TransactionClient) {
  return {
    create(input: z.input<typeof instrumentInput>) {
      return db.instrument.create({ data: instrumentInput.parse(input) });
    },
    find(symbol: string, exchange: string) {
      return db.instrument.findUnique({ where: { symbol_exchange: identity.parse({ symbol, exchange }) } });
    },
    addToWatchlist(instrumentId: string) {
      return db.watchlistEntry.create({ data: { instrumentId: z.uuid().parse(instrumentId) } });
    },
    removeFromWatchlist(instrumentId: string) {
      return db.watchlistEntry.delete({ where: { instrumentId: z.uuid().parse(instrumentId) } });
    },
  };
}
