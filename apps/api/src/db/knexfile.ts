import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Knex } from 'knex';
import { env, isTest } from '../config/env.js';

const dbDir = path.dirname(fileURLToPath(import.meta.url));

export function buildKnexConfig(database = isTest ? env.MYSQL_TEST_DATABASE : env.MYSQL_DATABASE) {
  return {
    client: 'mysql2',
    connection: {
      host: env.MYSQL_HOST,
      port: env.MYSQL_PORT,
      user: env.MYSQL_USER,
      password: env.MYSQL_PASSWORD,
      database,
      charset: 'utf8mb4',
      // Store and read DATETIME values as UTC; convert to Europe/Tirane at the edges.
      timezone: 'Z',
      dateStrings: false,
      supportBigNumbers: true,
      bigNumberStrings: false,
    },
    pool: { min: 0, max: 10 },
    migrations: {
      directory: path.join(dbDir, 'migrations'),
      tableName: 'knex_migrations',
      loadExtensions: ['.ts', '.js'],
    },
    seeds: {
      directory: path.join(dbDir, 'seeds'),
      loadExtensions: ['.ts', '.js'],
    },
  } satisfies Knex.Config;
}
