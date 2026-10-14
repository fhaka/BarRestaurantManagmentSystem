import { devices, expect, test } from '@playwright/test';
import { GUEST_PORT } from '../playwright.config';
import { signIn } from './helpers';

/** Tomorrow's date in Tirana (the booking page and the reservation book use local dates). */
function tomorrow(): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Tirane' }).format(new Date());
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

test('a guest books online → the manager sees it in the book and confirms it', async ({
  browser,
}) => {
  // The guest, on a phone, books for two tomorrow at 20:00.
  const phone = await (
    await browser.newContext({ ...devices['Pixel 7'], locale: 'sq-AL' })
  ).newPage();
  await phone.goto(`http://localhost:${GUEST_PORT}/book/1`);
  await phone.getByRole('radio', { name: /Nesër/ }).click();
  await phone.getByRole('radio', { name: '20:00' }).click();
  await phone.getByLabel('Emri').fill('Dea Online');
  await phone.getByLabel('Telefoni').fill('+355 69 555 0101');
  await phone.getByRole('button', { name: /^Rezervo/ }).click();
  await expect(phone.getByText('Faleminderit, Dea!')).toBeVisible();
  await expect(phone.getByText(/Kodi i rezervimit/)).toBeVisible();

  // The manager finds it in tomorrow's book, marked as online, and confirms it.
  const page = await signIn(browser, 'menaxher@lasvegas.test');
  await page.goto(`/reservations?date=${tomorrow()}&view=list`);
  const row = page.getByRole('row').filter({ hasText: 'Dea Online' });
  await expect(row).toContainText('20:00');
  await expect(row).toContainText('Online');
  await row.getByRole('button', { name: 'Dea Online' }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByRole('button', { name: 'Konfirmo' }).click();
  await expect(sheet.getByText('Konfirmuar')).toBeVisible();
});
