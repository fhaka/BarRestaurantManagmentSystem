import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATABASE = 'tavolina_e2e';

/**
 * Creates the e2e database (as MySQL root, like the docker init script does for the test
 * database), then migrates it and loads the demo data so every run starts from the same state.
 * Runs as part of the API web server command in playwright.config.ts: Playwright starts web
 * servers before its globalSetup, and the API needs the database at start-up.
 */
async function prepare() {
  dotenv.config({ path: path.join(root, '.env'), quiet: true });
  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST ?? '127.0.0.1',
    port: Number(process.env.MYSQL_PORT ?? 3310),
    user: 'root',
    password: process.env.MYSQL_ROOT_PASSWORD,
  });
  try {
    await connection.query(
      `CREATE DATABASE IF NOT EXISTS \`${DATABASE}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`,
    );
    await connection.query(`GRANT ALL PRIVILEGES ON \`${DATABASE}\`.* TO ?@'%'`, [
      process.env.MYSQL_USER ?? 'tavolina',
    ]);
  } finally {
    await connection.end();
  }

  for (const command of ['migrate', 'seed']) {
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/db/cli.ts', command], {
      cwd: path.join(root, 'apps', 'api'),
      env: { ...process.env, MYSQL_DATABASE: DATABASE, SEED_HISTORY_TODAY: 'false' },
      encoding: 'utf8',
    });
    if (result.status !== 0) {
      throw new Error(`e2e database ${command} failed:\n${result.stderr || result.stdout}`);
    }
  }
}

await prepare();
