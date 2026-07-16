import { createApp } from './app.js';
import { config } from './config/env.js';
import { connectDb, disconnectDb, supportsTransactions } from './config/db.js';
import { logger } from './utils/logger.js';

async function main() {
  await connectDb();
  // Probe once at boot so the first push doesn't pay for it.
  await supportsTransactions();

  const app = createApp();
  const server = app.listen(config.port, () => {
    logger.info({ port: config.port, env: config.env }, 'Lista+ API listening');
  });

  const shutdown = async (signal) => {
    logger.info({ signal }, 'Shutting down');
    server.close(async () => {
      await disconnectDb();
      process.exit(0);
    });
    // Don't let a hung connection block the deploy forever.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start server');
  process.exit(1);
});
