import { Router } from 'express';
import { z } from 'zod';
import { validateRequest } from '../middleware/validate-request.js';
import { dateKey, dateSchema, symbolSchema } from '../providers/market-data.js';
import type { MarketDataService, PriceQuery, SyncInput } from '../services/market-data.js';
import { HttpError } from '../utils/http-error.js';

const exchange = z.string().trim().toUpperCase().min(1).max(32).optional();
const params = z.strictObject({ symbol: symbolSchema });
const empty = z.strictObject({});
const syncBody = z.strictObject({ startDate: dateSchema.optional(), endDate: dateSchema.optional(), fullHistory: z.boolean().optional(), exchange })
  .refine((value) => !(value.fullHistory && value.startDate))
  .refine((value) => !value.startDate || !value.endDate || value.startDate <= value.endDate)
  .refine((value) => (!value.startDate || value.startDate <= dateKey(new Date())) && (!value.endDate || value.endDate <= dateKey(new Date())));
const priceQuery = z.strictObject({ from: dateSchema.optional(), to: dateSchema.optional(), after: dateSchema.optional(), exchange,
  adjustment: z.enum(['raw', 'total-return']).default('raw').transform((value) => value === 'raw' ? 'RAW' as const : 'TOTAL_RETURN' as const),
  limit: z.coerce.number().int().min(1).max(5000).default(1000),
}).refine((value) => !value.from || !value.to || value.from <= value.to);

export function createMarketDataRouter(service?: MarketDataService) {
  const router = Router();
  function available(): MarketDataService {
    if (!service) throw new HttpError(503, 'DATABASE_UNAVAILABLE', 'Configure and start the local database before using market data.');
    return service;
  }
  async function execute<T>(action: () => Promise<T>): Promise<T> {
    try { return await action(); } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(503, 'DATABASE_UNAVAILABLE', 'Market-data storage is unavailable. Check local database startup and migrations.');
    }
  }
  router.get('/stocks/:symbol/prices', validateRequest(z.object({ params, query: priceQuery, body: z.undefined() })), async (_request, response) => {
    const parsed = response.locals.validated as { params: { symbol: string }; query: PriceQuery };
    response.json({ data: await execute(() => available().getPrices(parsed.params.symbol, parsed.query)) });
  });
  router.post('/stocks/:symbol/sync', validateRequest(z.object({ params, query: empty, body: syncBody })), async (_request, response) => {
    const parsed = response.locals.validated as { params: { symbol: string }; body: SyncInput };
    const job = await execute(() => available().requestSync(parsed.params.symbol, parsed.body));
    response.setHeader('Location', `/api/sync-jobs/${job.id}`);
    response.status(202).json({ data: job });
  });
  router.get('/sync-jobs/:jobId', validateRequest(z.object({ params: z.strictObject({ jobId: z.uuid() }), query: empty, body: z.undefined() })), async (_request, response) => {
    response.json({ data: await execute(() => available().getJob((response.locals.validated as { params: { jobId: string } }).params.jobId)) });
  });
  router.get('/providers/tiingo', validateRequest(z.object({ params: empty, query: empty, body: z.undefined() })), async (_request, response) => {
    response.json({ data: await execute(() => available().getStatus()) });
  });
  for (const [path, allow] of [['/stocks/:symbol/prices', 'GET, HEAD, OPTIONS'], ['/stocks/:symbol/sync', 'POST, OPTIONS'], ['/sync-jobs/:jobId', 'GET, HEAD, OPTIONS'], ['/providers/tiingo', 'GET, HEAD, OPTIONS']]) {
    router.all(path!, (_request, response, next) => {
      response.setHeader('Allow', allow!);
      next(new HttpError(405, 'METHOD_NOT_ALLOWED', 'This endpoint does not support that HTTP method.'));
    });
  }
  return router;
}
