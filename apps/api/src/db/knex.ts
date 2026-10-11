import knexFactory, { type Knex } from 'knex';
import { buildKnexConfig } from './knexfile.js';

export const db: Knex = knexFactory(buildKnexConfig());

/** Returns true when the database answers a trivial query within the timeout. */
export async function pingDatabase(timeoutMs = 2000): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      db.raw('select 1'),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Database ping timed out')), timeoutMs);
      }),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
