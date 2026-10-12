import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

/** Walks up from this file to the monorepo root (the folder holding docker-compose.yml). */
function findRepoRoot(start: string): string {
  let dir = start;
  for (;;) {
    if (existsSync(path.join(dir, 'docker-compose.yml'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
}

// The single .env file lives at the repository root (shared with docker compose).
// In containers there is no .env file; variables come from the environment.
const repoRoot = findRepoRoot(path.dirname(fileURLToPath(import.meta.url)));
dotenv.config({ path: path.join(repoRoot, '.env'), quiet: true });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(4100),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5180,http://localhost:5181')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  MYSQL_HOST: z.string().default('127.0.0.1'),
  MYSQL_PORT: z.coerce.number().int().positive().default(3310),
  MYSQL_DATABASE: z.string().default('tavolina'),
  MYSQL_TEST_DATABASE: z.string().default('tavolina_test'),
  MYSQL_USER: z.string().default('tavolina'),
  MYSQL_PASSWORD: z.string().default(''),
  JWT_ACCESS_SECRET: z
    .string()
    .min(32, 'must be at least 32 characters; generate one with `openssl rand -hex 32`'),
  /** bcrypt cost for passwords and PINs. 12 per plan §11; tests use 4 for speed. */
  BCRYPT_COST: z.coerce.number().int().min(4).max(15).default(12),
  /** Public address of the guest app; table QR codes point to <GUEST_APP_URL>/t/<token>. */
  GUEST_APP_URL: z.url().default('http://localhost:5181'),
  /** Where uploaded images are stored. Defaults to apps/api/uploads. */
  UPLOADS_DIR: z.string().min(1).optional(),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${issues.join('\n')}`);
  }
  return parsed.data;
}

export const env = loadEnv();
export const isTest = env.NODE_ENV === 'test';
export const isProduction = env.NODE_ENV === 'production';
export const REPO_ROOT = repoRoot;
