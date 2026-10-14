/**
 * Programmatic Knex CLI so TypeScript migrations and seeds run under tsx
 * without ts-node. Usage: tsx src/db/cli.ts <migrate|rollback|seed>
 */
import { db } from './knex.js';
import { logger } from '../lib/logger.js';
import { syncReferenceData } from './sync-access.js';

const command = process.argv[2];

async function main() {
  switch (command) {
    case 'migrate': {
      const [batch, files] = (await db.migrate.latest()) as [number, string[]];
      logger.info(
        files.length ? `Batch ${batch}: ran ${files.length} migration(s)` : 'Already up to date',
      );
      await syncReferenceData(db);
      logger.info('Reference data synced');
      break;
    }
    case 'rollback': {
      const [batch, files] = (await db.migrate.rollback()) as [number, string[]];
      logger.info(`Rolled back batch ${batch}: ${files.length} migration(s)`);
      break;
    }
    case 'seed': {
      await syncReferenceData(db);
      const [files] = (await db.seed.run()) as [string[]];
      logger.info(`Ran ${files.length} seed file(s)`);
      break;
    }
    case 'demo': {
      // Loads the demo only into an empty database, so a container restart can never wipe data.
      const users = await db('users').count({ n: '*' }).first();
      if (Number(users?.n ?? 0) > 0) {
        logger.info('The database already has data; the demo was not loaded');
        break;
      }
      process.env.TAVOLINA_EMPTY_DB_CONFIRMED = 'true';
      await syncReferenceData(db);
      const [files] = (await db.seed.run()) as [string[]];
      logger.info(`Empty database: loaded the demo (${files.length} seed files)`);
      break;
    }
    default:
      throw new Error(
        `Unknown command "${String(command)}". Use migrate | rollback | seed | demo.`,
      );
  }
}

main()
  .catch((err: unknown) => {
    logger.error({ err }, 'Database command failed');
    process.exitCode = 1;
  })
  .finally(() => db.destroy());
