import express, { type Router } from 'express';
import type { AppConfig } from './config/env.js';
import { createApiRouter } from './routes/index.js';
import { errorHandler, notFound } from './middleware/error-handler.js';
import { localAccess } from './middleware/local-access.js';
import { requestContext } from './middleware/request-context.js';
import { logger, type Logger } from './utils/logger.js';
import type { DatabaseHealth } from './services/database.js';
import type { MarketDataService } from './services/market-data.js';
import type { SecService } from './services/sec.js';
import type { WatchlistService } from './services/watchlist.js';

export interface AppOptions {
  router?: Router;
  logger?: Logger;
  database?: DatabaseHealth;
  marketData?: MarketDataService;
  sec?: SecService;
  watchlist?: WatchlistService;
}

export function createApp(config: AppConfig, options: AppOptions = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);
  app.set('query parser', 'simple');

  app.use(requestContext);
  app.use(localAccess(config));
  app.use(express.json({ limit: '32kb', strict: true, inflate: false }));
  app.use(express.urlencoded({ extended: false, limit: '32kb', parameterLimit: 100, inflate: false }));
  app.use('/api', options.router ?? createApiRouter(options.database, options.marketData, options.sec, options.watchlist));
  app.use(notFound);
  app.use(errorHandler(options.logger ?? logger));
  return app;
}
