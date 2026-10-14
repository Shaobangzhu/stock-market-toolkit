import { createApp } from './app.js';
import { loadConfig, ConfigError } from './config/env.js';
import { logger } from './utils/logger.js';
import { createDatabase } from './services/database.js';
import { providerBudget } from './repositories/provider-budget.js';
import { TiingoMarketDataProvider } from './providers/tiingo.js';
import { createMarketDataService } from './services/market-data.js';
import { SecEdgarProvider } from './providers/sec-edgar.js';
import { secAdmission } from './repositories/sec.js';
import { createSecService } from './services/sec.js';
import { createWatchlistService } from './services/watchlist.js';
import { createStockOverviewService } from './services/stock-overview.js';
import { createValuationService } from './services/valuation.js';

// No other module reads process.env. Load dotenv and validate before creating services.
try {
  const config = loadConfig();
  const database = createDatabase(config);
  const tiingo = database ? new TiingoMarketDataProvider(config, providerBudget(database.client, config)) : undefined;
  const marketData = database && tiingo ? createMarketDataService(database.client, tiingo) : undefined;
  const watchlist = database && tiingo && marketData ? createWatchlistService(database.client, tiingo, marketData) : undefined;
  const stockOverview = database ? createStockOverviewService(database.client) : undefined;
  const sec = database ? createSecService(database.client, new SecEdgarProvider(config, { admission: secAdmission(database.client, config.SEC_EDGAR_MAX_RPS) })) : undefined;
  const closeDatabase = async () => {
    try { await sec?.stop(); } catch {
      logger.error({ event: 'server_stop_failed' });
      process.exitCode = 1;
    }
    try { await marketData?.stop(); } catch {
      logger.error({ event: 'server_stop_failed' });
      process.exitCode = 1;
    }
    try { await database?.close(); } catch {
      logger.error({ event: 'server_stop_failed' });
      process.exitCode = 1;
    }
  };
  const app = createApp(config, { ...(database ? { database, valuation: createValuationService(database.client) } : {}), ...(marketData ? { marketData } : {}), ...(sec ? { sec } : {}), ...(watchlist ? { watchlist } : {}), ...(stockOverview ? { stockOverview } : {}) });
  const server = app.listen(config.PORT, config.HOST, () => {
    logger.info({ event: 'server_started', host: config.HOST, port: config.PORT });
  });

  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;

  server.on('error', () => {
    logger.error({ event: 'server_start_failed' });
    process.exitCode = 1;
    void closeDatabase();
  });

  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ event: 'server_stopping' });
    const deadline = setTimeout(() => {
      server.closeAllConnections();
      process.exit(1); // Bound shutdown even if a driver/socket cannot close.
    }, 10_000).unref();
    server.close(async (error) => {
      if (error) {
        logger.error({ event: 'server_stop_failed' });
        process.exitCode = 1;
      }
      await closeDatabase();
      clearTimeout(deadline);
    });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
} catch (error) {
  logger.error({
    event: error instanceof ConfigError ? 'configuration_invalid' : 'server_start_failed',
    ...(error instanceof ConfigError ? { fields: error.fields } : {}),
  });
  process.exitCode = 1;
}
