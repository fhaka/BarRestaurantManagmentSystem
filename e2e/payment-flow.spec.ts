import { expect, test, type Page } from '@playwright/test';

// Demo accounts from apps/api/src/db/seeds/01_demo_access.ts.
const PASSWORD = 'Tavolina2026!';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('textbox', { name: 'Fjalëkalimi' }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Hyr' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

/** "4 625 L" with the non-breaking spaces formatMoney uses. */
const money = (text: string) => new RegExp(text.replace(/[()]/g, '\\$&').replace(/ /g, '\\s'));

test('cashier splits Salla 5 in two, takes cash with change and a card, closes the table', async ({
  page,
}) => {
  await signIn(page, 'arka@lasvegas.test');
  await page.goto('/cashier');
  await page.getByRole('button', { name: /^Tavolina 5/ }).click();
  await expect(page.getByRole('heading', { name: 'Fatura · Tavolina 5' })).toBeVisible();
  await expect(page.getByText(money('9 250 L')).first()).toBeVisible();

  // Split equally between two people.
  await page.getByRole('button', { name: 'Ndaj faturën' }).click();
  const split = page.getByRole('dialog', { name: 'Ndaj faturën' });
  await split.getByRole('button', { name: 'Barabar' }).click();
  await split.getByRole('button', { name: 'Ndaj', exact: true }).click();
  await expect(page.getByText('Pjesa 1/2')).toBeVisible();

  // Share 1: cash, the guest gives 5 000 L → 375 L change.
  await page
    .getByRole('button', { name: money('Paguaj 4 625 L') })
    .first()
    .click();
  const pay = page.getByRole('dialog', { name: 'Pagesa · Pjesa 1/2' });
  await pay.getByRole('button', { name: money('5 000 L') }).click();
  await expect(pay.getByText(money('375 L'))).toBeVisible();
  await pay.getByRole('button', { name: /^Merr / }).click();
  await expect(page.getByText(money('U pagua. Kthe 375 L')).first()).toBeVisible();

  // Share 2: card with a 10% tip.
  await page.getByRole('button', { name: money('Paguaj 4 625 L') }).click();
  const card = page.getByRole('dialog', { name: 'Pagesa · Pjesa 2/2' });
  await card.getByRole('button', { name: 'Kartë' }).click();
  await card.getByRole('button', { name: /^10%/ }).click();
  await card.getByRole('button', { name: /^Merr / }).click();

  // Both bills are fiscalized; the table can close.
  await expect(page.getByText(/^E fiskalizuar · \d+\/\d{4}\//)).toHaveCount(2);
  await expect(page.getByText('E paguar plotësisht')).toBeVisible();
  await page.getByRole('button', { name: 'Mbyll tavolinën' }).click();
  await expect(page).toHaveURL(/\/floor$/);

  // The X report matches what was taken.
  await page.goto('/cashier?tab=day');
  const payments = page
    .locator('section, div')
    .filter({ has: page.getByRole('heading', { name: 'Pagesat' }) })
    .last();
  await expect(payments).toContainText(money('Kesh (1)4 625 L'));
  await expect(payments).toContainText(money('Kartë (1)4 625 L'));
  await expect(payments).toContainText(money('Totali i marrë9 250 L'));
  await expect(payments).toContainText(money('Bakshishe463 L'));
});
