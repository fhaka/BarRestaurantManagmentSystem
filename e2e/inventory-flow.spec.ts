import { expect, test } from '@playwright/test';
import { dbQuery, signIn } from './helpers';

const milk = async () =>
  Number(
    (
      await dbQuery<{ q: string }>(
        "SELECT stock_qty AS q FROM ingredients WHERE name = 'Qumësht i plotë'",
      )
    )[0]!.q,
  );

test('waste is booked out of stock and shows in the ledger', async ({ browser }) => {
  const before = await milk();
  const page = await signIn(browser, 'menaxher@lasvegas.test');
  await page.goto('/inventory');
  await page.getByRole('button', { name: 'Regjistro humbje' }).click();
  const dialog = page.getByRole('dialog', { name: 'Humbje ose ushqim stafi' });
  await dialog.getByRole('combobox', { name: 'Përbërësi' }).click();
  await page.getByRole('option', { name: 'Qumësht i plotë' }).click();
  await dialog.getByLabel('Sasia').fill('0,5');
  await dialog.getByLabel('Arsyeja').fill('Skadoi në frigorifer');
  await dialog.getByRole('button', { name: 'Regjistro' }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(milk).toBeCloseTo(before - 0.5, 3);

  await page.getByRole('tab', { name: 'Lëvizjet' }).click();
  const row = page.getByRole('row').filter({ hasText: 'Skadoi në frigorifer' }).first();
  await expect(row).toContainText('Qumësht i plotë');
  await expect(row).toContainText(/-0[.,]5\s*l/);
});
