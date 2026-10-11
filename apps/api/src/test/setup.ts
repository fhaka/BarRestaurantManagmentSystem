import { afterAll } from 'vitest';
import { db } from '../db/knex.js';

// Each test file gets its own module graph and connection pool; close it when the file is done.
afterAll(async () => {
  await db.destroy();
});
