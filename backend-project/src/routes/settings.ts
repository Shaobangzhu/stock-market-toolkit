import { Router } from 'express';
import { z } from 'zod';
import { validateRequest } from '../middleware/validate-request.js';
import { preferenceSchema, type SettingsService } from '../services/settings.js';
import { HttpError } from '../utils/http-error.js';

export function createSettingsRouter(service?: SettingsService) {
  const router = Router(), empty = z.strictObject({});
  function available() { if (!service) throw new HttpError(503, 'DATABASE_UNAVAILABLE', 'Settings service unavailable.'); return service; }
  const pagination = z.strictObject({ offset: z.coerce.number().int().min(0).max(10000).default(0) });
  function route<B extends z.ZodType, Q extends z.ZodType>(method: 'get' | 'post', path: string, body: B, query: Q, action: (value: { body: z.output<B>; query: z.output<Q> }) => Promise<unknown>) {
    router[method](path, validateRequest(z.object({ params: empty, query, body })), async (_req, res) => {
      try { const data = await action(res.locals.validated); res.status(path.endsWith('/sync-watchlist') || path.endsWith('/retry-sync') ? 202 : path.endsWith('/import-csv') ? 201 : 200).json({ data }); }
      catch (e) { if (e instanceof HttpError) throw e; throw new HttpError(503, 'DATABASE_UNAVAILABLE', 'Local data operation failed. Check PostgreSQL and migrations.'); }
    });
  }
  route('get', '/settings/status', z.undefined(), empty, () => available().overview());
  route('get', '/settings/preferences', z.undefined(), empty, () => available().preferences());
  route('post', '/settings/preferences', preferenceSchema, empty, v => available().savePreferences(v.body));
  route('get', '/settings/jobs', z.undefined(), pagination, v => available().jobs(v.query.offset));
  route('get', '/settings/coverage', z.undefined(), pagination, v => available().coverage(v.query.offset));
  route('post', '/settings/sync-watchlist', empty, empty, () => available().syncWatchlist());
  route('post', '/settings/retry-sync', z.strictObject({ jobId: z.uuid() }), empty, v => available().retry(v.body.jobId));
  route('post', '/settings/import-csv', z.strictObject({ csv: z.string().min(1).max(30000) }), empty, v => available().importCsv(v.body.csv));
  route('get', '/settings/export-research', z.undefined(), empty, () => available().exportResearch());
  const methods: Record<string, string> = { status: 'GET, HEAD, OPTIONS', preferences: 'GET, HEAD, POST, OPTIONS', jobs: 'GET, HEAD, OPTIONS', coverage: 'GET, HEAD, OPTIONS', 'sync-watchlist': 'POST, OPTIONS', 'retry-sync': 'POST, OPTIONS', 'import-csv': 'POST, OPTIONS', 'export-research': 'GET, HEAD, OPTIONS' };
  router.all('/settings/:action', (req, res, next) => { const allow = methods[String(req.params.action)]; if (!allow) { next(); return; } res.setHeader('Allow', allow); next(new HttpError(405, 'METHOD_NOT_ALLOWED', 'Unsupported method.')); });
  return router;
}
