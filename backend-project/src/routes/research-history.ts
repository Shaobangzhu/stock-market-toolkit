import { Router } from 'express';
import { z } from 'zod';
import { dateSchema, symbolSchema } from '../providers/market-data.js';
import { validateRequest } from '../middleware/validate-request.js';
import { noteInputSchema, type ResearchHistoryService } from '../services/research-history.js';
import { HttpError } from '../utils/http-error.js';
export function createResearchHistoryRouter(service?: ResearchHistoryService) {
  const router = Router(), kind = z.enum(['REPORT', 'SCENARIO', 'NOTE']);
  const query = z.strictObject({ symbol: symbolSchema.optional(), exchange: z.string().trim().toUpperCase().min(1).max(32).optional(), trackedOnly: z.enum(['true','false']).default('false').transform(v => v === 'true'),
    search: z.string().trim().max(200).optional(), kind: kind.optional(), from: dateSchema.optional(), to: dateSchema.optional(), limit: z.coerce.number().int().min(1).max(50).default(50), offset: z.coerce.number().int().min(0).max(10000).default(0) })
    .refine(v => !v.from || !v.to || v.from <= v.to, 'Invalid date range.').refine(v => !!v.symbol !== v.trackedOnly, 'Choose a stock or tracked-stock scope.');
  const paths = ['/research/history', '/research/records/:kind/:id', '/stocks/:symbol/notes'] as const;
  for (const [index, path] of paths.entries()) {
    const write = index === 2;
    const schema = z.object({ params: index === 0 ? z.strictObject({}) : write ? z.strictObject({ symbol: symbolSchema }) : z.strictObject({ kind, id: z.uuid() }), query: index === 0 ? query : z.strictObject({}), body: write ? noteInputSchema : z.undefined() });
    router[write ? 'post' : 'get'](path, validateRequest(schema), async (_req, res) => {
      if (!service) throw new HttpError(503, 'DATABASE_UNAVAILABLE', 'Local research storage is unavailable.');
      const { params: p, query: q, body: b } = res.locals.validated;
      try { res.status(write ? 201 : 200).json({ data: index === 0 ? await service.list(q) : write ? await service.saveNote(p.symbol, b) : await service.detail(p.kind, p.id) }); }
      catch (e) { if (e instanceof HttpError) throw e; throw new HttpError(503, 'DATABASE_UNAVAILABLE', 'Local research storage is unavailable.'); }
    });
    router.all(path, (_req, res, next) => { res.setHeader('Allow', write ? 'POST, OPTIONS' : 'GET, HEAD, OPTIONS'); next(new HttpError(405, 'METHOD_NOT_ALLOWED', 'Unsupported method.')); });
  }
  return router;
}
