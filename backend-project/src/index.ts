import { createApp } from './app.js';
import { loadConfig, ConfigError } from './config/env.js';
import { logger } from './utils/logger.js';
import { createDatabase } from './services/database.js';

// No other module reads process.env. Load dotenv and validate before creating services.
try {
  const config = loadConfig();
  const database = createDatabase(config);
  const closeDatabase = async () => {
    try { await database?.close(); } catch {
      logger.error({ event: 'server_stop_failed' });
      process.exitCode = 1;
    }
  };
  const app = createApp(config, database ? { database } : {});
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
