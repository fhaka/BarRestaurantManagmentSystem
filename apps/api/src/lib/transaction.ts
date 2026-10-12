import type { Knex } from 'knex';
import { db } from '../db/knex.js';

const RETRYABLE = new Set(['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT']);

/**
 * Runs a transaction, retrying when MySQL aborts it because of a deadlock (e.g. two waiters
 * opening the same table at the same moment). On the retry the loser sees the winner's row and
 * fails with a proper domain error instead of a 500.
 */
export async function transactionWithRetry<T>(
  work: (trx: Knex.Transaction) => Promise<T>,
  attempts = 3,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await db.transaction(work);
    } catch (err) {
      const code =
        typeof err === 'object' && err !== null ? (err as { code?: string }).code : undefined;
      if (!code || !RETRYABLE.has(code) || attempt >= attempts) throw err;
      await new Promise((resolve) => setTimeout(resolve, 20 * attempt + Math.random() * 30));
    }
  }
}
