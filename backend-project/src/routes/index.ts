import { Router } from 'express';
import { createHealthRouter } from './health.js';
import { createReadyRouter } from './ready.js';
import type { DatabaseHealth } from '../services/database.js';
import type { MarketDataService } from '../services/market-data.js';
import { createMarketDataRouter } from './market-data.js';

export function createApiRouter(database?: DatabaseHealth, marketData?: MarketDataService) {
  const router = Router();
  router.use('/health', createHealthRouter());
  router.use('/ready', createReadyRouter(database));
  router.use(createMarketDataRouter(marketData));
  return router;
}
