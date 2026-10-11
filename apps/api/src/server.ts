import { createServer } from 'node:http';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { db } from './db/knex.js';
import { syncReferenceData } from './db/sync-access.js';
import { logger } from './lib/logger.js';

const app = createApp();
const server = createServer(app);

// Keep role → permission rows in line with the code before serving requests (D-016).
syncReferenceData(db)
  .catch((err: unknown) => logger.warn({ err }, 'Could not sync roles; run npm run db:migrate'))
  .finally(() => {
    server.listen(env.API_PORT, () => {
      logger.info(`Tavolina API listening on http://localhost:${env.API_PORT}`);
    });
  });

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`${signal} received, shutting down`);
  server.close();
  await db.destroy().catch(() => undefined);
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
