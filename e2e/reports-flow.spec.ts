import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

test('dashboard and reports show the month and export CSV', async ({ browser }) => {
  const page = await signIn(browser, 'menaxher@lasvegas.test');
  // Managers land on the dashboard.
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByText('Të ardhurat sot')).toBeVisible();
  await expect(page.getByText('Të ardhurat sipas orës')).toBeVisible();

  await page.goto('/reports');
  await expect(page.getByText('Orët më të ngarkuara')).toBeVisible();
  // The heatmap has a cell per weekday and opening hour of the 30-day history.
  await expect(page.getByRole('grid').getByRole('button').first()).toBeVisible();

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Shkarko CSV' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^shitjet-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.csv$/);
  const lines = (await readFile((await file.path())!, 'utf8'))
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/);
  expect(lines[0]).toBe('Data,Të ardhurat,Porosi,Mysafirë,Fatura mesatare');
  expect(lines.length).toBeGreaterThan(28);

  await page.getByRole('tab', { name: 'Artikujt dhe marzhi' }).click();
  await expect(page.getByRole('row').filter({ hasText: 'Tavë kosi' }).first()).toBeVisible();
});
