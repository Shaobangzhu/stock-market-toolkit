import { Router } from 'express';
import { z } from 'zod';
import { symbolSchema } from '../providers/market-data.js';
import { validateRequest } from '../middleware/validate-request.js';
import { valuationSchema } from '../services/valuation-engine.js';
import type { ValuationService } from '../services/valuation.js';
import { HttpError } from '../utils/http-error.js';

export function createValuationRouter(service?: ValuationService) {
  const router = Router(), params = z.strictObject({ symbol: symbolSchema });
  const exchange = z.string().trim().toUpperCase().min(1).max(32);
  const save = z.strictObject({ assumptions: valuationSchema, expectedHash: z.string().regex(/^[a-f0-9]{64}$/), seriesId: z.uuid().optional(), expectedVersion: z.number().int().positive().optional() })
    .refine(v => !!v.seriesId === !!v.expectedVersion, 'Series and expected version must be provided together.');
  for (const action of ['sources', 'scenarios', 'calculate', 'save'] as const) {
    const read = action === 'sources' || action === 'scenarios';
    const path = `/stocks/:symbol/valuation/${action}`;
    const schema = z.object({ params, query: read ? z.strictObject({ exchange, ...(action === 'sources' ? { cutoff: z.iso.datetime() } : {}) }) : z.strictObject({}),
      body: read ? z.undefined() : action === 'calculate' ? valuationSchema : save });
    router[read ? 'get' : 'post'](path, validateRequest(schema), async (_req, res) => {
      if (!service) throw new HttpError(503, 'DATABASE_UNAVAILABLE', 'Configure the local database before calculating scenarios.');
      const { params: p, query: q, body: b } = res.locals.validated;
      try {
        const data = action === 'sources' ? await service.sources(p.symbol, q.exchange, q.cutoff) : action === 'scenarios' ? await service.list(p.symbol, q.exchange)
          : action === 'calculate' ? await service.calculate(p.symbol, b) : await service.save(p.symbol, b.assumptions, b.expectedHash, b.seriesId, b.expectedVersion);
        res.status(action === 'save' ? 201 : 200).json({ data });
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw new HttpError(503, 'DATABASE_UNAVAILABLE', 'Scenario storage is unavailable. Check local PostgreSQL and retry.');
      }
    });
    router.all(path, (_req, res, next) => { res.setHeader('Allow', read ? 'GET, HEAD, OPTIONS' : 'POST, OPTIONS'); next(new HttpError(405, 'METHOD_NOT_ALLOWED', 'Unsupported method.')); });
  }
  return router;
}
