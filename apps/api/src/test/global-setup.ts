import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Brings the test database schema up to date once per run. Runs the same CLI as
 * `npm run db:migrate` in a child process (tsx loader), with NODE_ENV=test so it
 * targets MYSQL_TEST_DATABASE.
 */
export default function setup() {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/db/cli.ts', 'migrate'], {
    cwd: apiRoot,
    env: { ...process.env, NODE_ENV: 'test' },
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(
      `Test database migration failed. Is MySQL running (docker compose up -d)?\n${result.stderr || result.stdout}`,
    );
  }
}
