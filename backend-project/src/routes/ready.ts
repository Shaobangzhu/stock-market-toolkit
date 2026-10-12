import { Router } from 'express';
import { z } from 'zod';
import type { DatabaseHealth } from '../services/database.js';
import { validateRequest } from '../middleware/validate-request.js';
import { HttpError } from '../utils/http-error.js';

export function createReadyRouter(database?: DatabaseHealth) {
  const router = Router();
  router.get('/', validateRequest(z.object({
    params: z.strictObject({}), query: z.strictObject({}), body: z.undefined(),
  })), async (_request, response) => {
    let ready = false;
    try { ready = await database?.ready() ?? false; } catch { /* safe 503 */ }
    if (!ready) throw new HttpError(503, 'DATABASE_UNAVAILABLE', 'Database is not ready. Check local database startup and migrations.');
    response.json({ data: { status: 'ready', database: 'ok' } });
  });
  router.all('/', (_request, response, next) => {
    response.setHeader('Allow', 'GET, HEAD, OPTIONS');
    next(new HttpError(405, 'METHOD_NOT_ALLOWED', 'This endpoint only supports GET.'));
  });
  return router;
}
