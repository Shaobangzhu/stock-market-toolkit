import { Router } from 'express';
import { z } from 'zod';
import { validateRequest } from '../middleware/validate-request.js';
import { symbolSchema } from '../providers/market-data.js';
import { overviewRange, type StockOverviewService } from '../services/stock-overview.js';
import { HttpError } from '../utils/http-error.js';

export function createStockOverviewRouter(service?: StockOverviewService) {
  const router = Router(), exchange = z.string().trim().toUpperCase().min(1).max(32).optional();
  for (const name of ['overview', 'research'] as const) {
    const query = name === 'overview' ? z.strictObject({ range: overviewRange.default('1Y'), exchange }) : z.strictObject({ limit: z.coerce.number().int().min(1).max(50).default(5), exchange });
    router.get(`/stocks/:symbol/${name}`, validateRequest(z.object({ params: z.strictObject({ symbol: symbolSchema }), query, body: z.undefined() })), async (_request, response) => {
      if (!service) throw new HttpError(503, 'DATABASE_UNAVAILABLE', 'Configure the local database before opening Stock Research.');
      const parsed = response.locals.validated;
      try { response.json({ data: name === 'overview' ? await service.getOverview(parsed.params.symbol, parsed.query.range, parsed.query.exchange) : await service.getHistory(parsed.params.symbol, parsed.query.limit, parsed.query.exchange) }); }
      catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(503, 'DATABASE_UNAVAILABLE', 'Stock Research storage is unavailable. Check local PostgreSQL startup and migrations.'); }
    });
    router.all(`/stocks/:symbol/${name}`, (_request, response, next) => { response.setHeader('Allow', 'GET, HEAD, OPTIONS'); next(new HttpError(405, 'METHOD_NOT_ALLOWED', 'This endpoint does not support that HTTP method.')); });
  }
  return router;
}
