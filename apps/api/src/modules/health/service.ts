import type { HealthResponse } from '@tavolina/shared';
import { pingDatabase } from '../../db/knex.js';
import { APP_VERSION } from '../../lib/version.js';

export async function getHealth(): Promise<HealthResponse> {
  const databaseUp = await pingDatabase();
  return {
    status: databaseUp ? 'ok' : 'degraded',
    version: APP_VERSION,
    time: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    checks: { database: databaseUp ? 'up' : 'down' },
  };
}
