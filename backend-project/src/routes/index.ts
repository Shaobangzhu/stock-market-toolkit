import { Router } from 'express';
import { createHealthRouter } from './health.js';
import { createReadyRouter } from './ready.js';
import type { DatabaseHealth } from '../services/database.js';
import type { MarketDataService } from '../services/market-data.js';
import { createMarketDataRouter } from './market-data.js';
import { createSecRouter } from './sec.js';
import type { SecService } from '../services/sec.js';
import type { WatchlistService } from '../services/watchlist.js';
import { createWatchlistRouter } from './watchlist.js';
import { createStockOverviewRouter } from './stock-overview.js';
import type { StockOverviewService } from '../services/stock-overview.js';

export function createApiRouter(database?: DatabaseHealth, marketData?: MarketDataService, sec?: SecService, watchlist?: WatchlistService, stockOverview?: StockOverviewService) {
  const router = Router();
  router.use('/health', createHealthRouter());
  router.use('/ready', createReadyRouter(database));
  router.use(createMarketDataRouter(marketData));
  router.use(createSecRouter(sec));
  router.use(createWatchlistRouter(watchlist));
  router.use(createStockOverviewRouter(stockOverview));
  return router;
}
