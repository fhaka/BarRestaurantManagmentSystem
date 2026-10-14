import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

test('the audit log shows who approved voids and what changed', async ({ browser }) => {
  const page = await signIn(browser, 'menaxher@lasvegas.test');
  await page.goto('/audit');
  // The sign-in just now is the newest entry.
  await expect(page.getByRole('row').nth(1)).toContainText('Hyrje në sistem');

  await page.getByRole('button', { name: 'Vetëm me miratim' }).click();
  const first = page.getByRole('row').nth(1);
  await expect(first).toContainText('Miratoi Elira Shehu');
  await first.getByRole('button', { name: 'Detajet' }).click();
  await expect(page.getByText('Para', { exact: true })).toBeVisible();
  await expect(page.getByText('Pas', { exact: true })).toBeVisible();
});
