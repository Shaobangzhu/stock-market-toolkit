import { Router } from 'express';
import { z } from 'zod';
import { validateRequest } from '../middleware/validate-request.js';
import { symbolSchema } from '../providers/market-data.js';
import type { SecService, SecQuery, SecSyncInput } from '../services/sec.js';
import { HttpError } from '../utils/http-error.js';

const empty = z.strictObject({});
const params = z.strictObject({ symbol: symbolSchema });
const exchange = z.string().trim().toUpperCase().min(1).max(32).optional();
const asOf = z.iso.datetime({ offset: true }).refine((value) => Date.parse(value) <= Date.now(), 'Future research cutoff is not supported').optional();
export function createSecRouter(service?: SecService) {
  const router = Router();
  async function execute<T>(action: (service: SecService) => Promise<T>): Promise<T> {
    if (!service) throw new HttpError(503, 'DATABASE_UNAVAILABLE', 'Configure and start the local database before using SEC data.');
    try { return await action(service); } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(503, 'DATABASE_UNAVAILABLE', 'SEC storage is unavailable. Check local database startup and migrations.');
    }
  }
  for (const name of ['fundamentals', 'filings'] as const) {
    const query = name === 'fundamentals' ? z.strictObject({ exchange, asOf, limit: z.coerce.number().int().min(1).max(40).default(12) })
      : z.strictObject({ exchange, asOf, limit: z.coerce.number().int().min(1).max(200).default(50), after: z.uuid().optional(), form: z.enum(['10-K', '10-Q', '8-K']).optional() });
    router.get(`/stocks/:symbol/${name}`, validateRequest(z.object({ params, query, body: z.undefined() })), async (_request, response) => {
      const input = response.locals.validated as { params: { symbol: string }; query: SecQuery };
      const data = name === 'fundamentals' ? await execute((s) => s.getFundamentals(input.params.symbol, input.query))
        : await execute((s) => s.getFilings(input.params.symbol, input.query));
      response.json({ data });
    });
    router.all(`/stocks/:symbol/${name}`, (_request, response, next) => { response.setHeader('Allow', 'GET, HEAD, OPTIONS'); next(new HttpError(405, 'METHOD_NOT_ALLOWED', 'This endpoint does not support that HTTP method.')); });
  }
  router.post('/stocks/:symbol/fundamentals/sync', validateRequest(z.object({ params, query: empty, body: z.strictObject({ exchange }) })), async (_request, response) => {
    const input = response.locals.validated as { params: { symbol: string }; body: SecSyncInput };
    const job = await execute((s) => s.requestSync(input.params.symbol, input.body));
    response.setHeader('Location', `/api/sync-jobs/${job.id}`); response.status(202).json({ data: job });
  });
  router.get('/providers/sec-edgar', validateRequest(z.object({ params: empty, query: empty, body: z.undefined() })), async (_request, response) => { response.json({ data: await execute((s) => s.getStatus()) }); });
  for (const [path, allow] of [['/stocks/:symbol/fundamentals/sync', 'POST, OPTIONS'], ['/providers/sec-edgar', 'GET, HEAD, OPTIONS']]) {
    router.all(path!, (_request, response, next) => { response.setHeader('Allow', allow!); next(new HttpError(405, 'METHOD_NOT_ALLOWED', 'This endpoint does not support that HTTP method.')); });
  }
  return router;
}
