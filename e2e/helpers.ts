import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { expect, type Browser, type Page } from '@playwright/test';
import { E2E_DATABASE } from '../playwright.config';

// Demo accounts from apps/api/src/db/seeds/01_demo_access.ts.
export const PASSWORD = 'Tavolina2026!';

/** Signs in on a fresh browser context (each person gets their own cookies). */
export async function signIn(browser: Browser, email: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('textbox', { name: 'Fjalëkalimi' }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Hyr' }).click();
  await expect(page).not.toHaveURL(/\/login/);
  return page;
}

/** A read-only query against the e2e database (to find ids and tokens the UI shows). */
export async function dbQuery<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  dotenv.config({
    path: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env'),
    quiet: true,
  });
  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST ?? '127.0.0.1',
    port: Number(process.env.MYSQL_PORT ?? 3310),
    user: process.env.MYSQL_USER ?? 'tavolina',
    password: process.env.MYSQL_PASSWORD,
    database: E2E_DATABASE,
  });
  try {
    const [rows] = await connection.query(sql, params);
    return rows as T[];
  } finally {
    await connection.end();
  }
}

/** The QR token of a demo table (what the printed QR code points to). */
export async function qrToken(area: string, table: string): Promise<string> {
  const rows = await dbQuery<{ qr_token: string }>(
    'SELECT t.qr_token FROM tables t JOIN areas a ON a.id = t.area_id WHERE a.name = ? AND t.name = ?',
    [area, table],
  );
  return rows[0]!.qr_token;
}
