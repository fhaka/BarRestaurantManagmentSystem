import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { devices, expect, test, type Browser, type Page } from '@playwright/test';
import { E2E_DATABASE, GUEST_PORT } from '../playwright.config';

// Demo accounts from apps/api/src/db/seeds/01_demo_access.ts.
const PASSWORD = 'Tavolina2026!';

/** The QR token of a demo table (what the printed QR code points to). */
async function qrToken(area: string, table: string): Promise<string> {
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
    const [rows] = await connection.query(
      'SELECT t.qr_token FROM tables t JOIN areas a ON a.id = t.area_id WHERE a.name = ? AND t.name = ?',
      [area, table],
    );
    return (rows as { qr_token: string }[])[0]!.qr_token;
  } finally {
    await connection.end();
  }
}

async function signIn(browser: Browser, email: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('textbox', { name: 'Fjalëkalimi' }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Hyr' }).click();
  await expect(page).not.toHaveURL(/\/login/);
  return page;
}

test('guest orders from the QR menu → waiter confirms → kitchen → guest sees it ready', async ({
  browser,
}) => {
  // A phone scans the QR code on free table Salla 4 (Albanian phone).
  const token = await qrToken('Salla', '4');
  const phoneContext = await browser.newContext({ ...devices['Pixel 7'], locale: 'sq-AL' });
  const phone = await phoneContext.newPage();
  await phone.goto(`http://localhost:${GUEST_PORT}/t/${token}`);
  await expect(phone.getByRole('heading', { name: 'Tavolina 4' })).toBeVisible();

  await phone.getByRole('searchbox', { name: 'Kërko në menu' }).fill('Tavë kosi');
  await phone.getByRole('button', { name: /^Tavë kosi/ }).click();
  await phone.getByRole('button', { name: /^Shto në porosi/ }).click();
  await phone.getByRole('button', { name: /^Shiko porosinë \(1\)/ }).click();
  await phone.getByRole('button', { name: 'Porosit', exact: true }).click();
  const status = phone.getByRole('dialog', { name: 'Gjendja e porosisë' });
  await expect(status.getByText('Në pritje të kamarierit')).toBeVisible();
  await expect(status.getByText('E porositur nga ju')).toBeVisible();

  // The waiter sees the table asking for confirmation and sends the order to the kitchen.
  const waiter = await signIn(browser, 'kamarier@lasvegas.test');
  await waiter.getByRole('button', { name: /^Tavolina 4: .*porosi QR për konfirmim/ }).click();
  await waiter.getByRole('link', { name: 'Shiko' }).click();
  await expect(waiter.getByText('1 pjatë e porositur nga telefoni')).toBeVisible();
  await waiter.getByRole('button', { name: 'Konfirmo dhe dërgo' }).click();
  await expect(waiter.getByText('Porosia e klientit shkoi në kuzhinë')).toBeVisible();

  // The phone follows along live.
  await expect(status.getByText('U mor në kuzhinë')).toBeVisible();

  // The kitchen gets the ticket and bumps it.
  const kitchen = await signIn(browser, 'kuzhina@lasvegas.test');
  await kitchen.getByRole('button', { name: 'Kuzhina', exact: true }).click();
  const ticket = kitchen.locator('article').filter({ hasText: 'Tavolina 4' });
  await expect(ticket).toContainText('Tavë kosi');
  await ticket.getByRole('button', { name: /^Shëno fletën \d+ gati$/ }).click();

  // The guest sees it ready without reloading.
  await expect(status.getByText('Gati — po vjen')).toBeVisible();
});
