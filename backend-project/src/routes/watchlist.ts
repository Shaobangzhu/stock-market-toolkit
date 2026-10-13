import { Router } from 'express';
import { z } from 'zod';
import { validateRequest } from '../middleware/validate-request.js';
import { dateKey, dateSchema, symbolSchema } from '../providers/market-data.js';
import { researchStatus, tagsSchema, type WatchlistService, type WatchlistQuery, type WatchlistUpdate } from '../services/watchlist.js';
import { HttpError } from '../utils/http-error.js';

const empty = z.strictObject({});
const idParams = z.strictObject({ id: z.uuid() });
const booleanQuery = z.enum(['true', 'false']).transform((value) => value === 'true');
const listQuery = z.strictObject({ search: z.string().trim().max(100).optional(), status: researchStatus.optional(), tag: z.string().trim().max(32).optional(),
  includeArchived: booleanQuery.default(false), nearEntry: booleanQuery.default(false), nearPercent: z.coerce.number().min(0).max(50).default(5),
  sort: z.enum(['symbol', 'company', 'price', 'distance', 'status', 'lastResearch', 'lastUpdated']).default('symbol'), direction: z.enum(['asc', 'desc']).default('asc') });
const initialSync = z.strictObject({ startDate: dateSchema }).refine((value) => value.startDate <= dateKey(new Date()));
export function createWatchlistRouter(service?: WatchlistService) {
  const router = Router();
  async function execute<T>(action: (service: WatchlistService) => Promise<T>) {
    if (!service) throw new HttpError(503, 'DATABASE_UNAVAILABLE', 'Configure and start the local database before using the Watchlist.');
    try { return await action(service); } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(503, 'DATABASE_UNAVAILABLE', 'Watchlist storage is unavailable. Check local database startup and migrations.');
    }
  }
  router.post('/instruments/search', validateRequest(z.object({ params: empty, query: empty, body: z.strictObject({ query: z.string().trim().min(1).max(100).regex(/^[^\x00-\x1f\x7f]+$/) }) })), async (_request, response) => {
    response.json({ data: await execute((s) => s.search((response.locals.validated as { body: { query: string } }).body.query)) });
  });
  router.post('/instruments/resolve', validateRequest(z.object({ params: empty, query: empty, body: z.strictObject({ symbol: symbolSchema }) })), async (_request, response) => {
    response.json({ data: await execute((s) => s.resolve((response.locals.validated as { body: { symbol: string } }).body.symbol)) });
  });
  router.get('/watchlist', validateRequest(z.object({ params: empty, query: listQuery, body: z.undefined() })), async (_request, response) => {
    response.json({ data: await execute((s) => s.list((response.locals.validated as { query: WatchlistQuery }).query)) });
  });
  router.post('/watchlist', validateRequest(z.object({ params: empty, query: empty, body: z.strictObject({ resolutionToken: z.uuid(), initialSync: initialSync.optional() }) })), async (_request, response) => {
    const { body } = response.locals.validated as { body: { resolutionToken: string; initialSync?: { startDate: string } } };
    const added = await execute((s) => s.add(body.resolutionToken, body.initialSync));
    response.setHeader('Location', `/api/watchlist/${added.id}`); response.status(201).json({ data: added });
  });
  router.patch('/watchlist/:id', validateRequest(z.object({ params: idParams, query: empty, body: z.strictObject({ revision: z.number().int().min(1), researchStatus: researchStatus.optional(), tags: tagsSchema.optional(), notes: z.string().max(8000).refine(value => !value.includes('\u0000')).optional() })
    .refine((value) => value.researchStatus !== undefined || value.tags !== undefined || value.notes !== undefined) })), async (_request, response) => {
    const input = response.locals.validated as { params: { id: string }; body: WatchlistUpdate };
    response.json({ data: await execute((s) => s.update(input.params.id, input.body)) });
  });
  router.delete('/watchlist/:id', validateRequest(z.object({ params: idParams, query: empty, body: empty })), async (_request, response) => {
    response.json({ data: await execute((s) => s.remove((response.locals.validated as { params: { id: string } }).params.id)) });
  });
  for (const [path, allow] of [['/instruments/search', 'POST, OPTIONS'], ['/instruments/resolve', 'POST, OPTIONS'], ['/watchlist', 'GET, HEAD, POST, OPTIONS'], ['/watchlist/:id', 'PATCH, DELETE, OPTIONS']]) {
    router.all(path!, (_request, response, next) => { response.setHeader('Allow', allow!); next(new HttpError(405, 'METHOD_NOT_ALLOWED', 'This endpoint does not support that HTTP method.')); });
  }
  return router;
}
