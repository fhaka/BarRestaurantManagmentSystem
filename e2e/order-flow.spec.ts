import { expect, test, type Browser, type Page } from '@playwright/test';

// Demo accounts from apps/api/src/db/seeds/01_demo_access.ts.
const PASSWORD = 'Tavolina2026!';

async function signIn(browser: Browser, email: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('textbox', { name: 'Fjalëkalimi' }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Hyr' }).click();
  await expect(page).not.toHaveURL(/\/login/);
  return page;
}

/** Adds the one dish matching the search (Enter adds a single match). */
async function addBySearch(page: Page, name: string) {
  const search = page.getByRole('searchbox', { name: 'Kërko në menu' });
  await search.fill(name);
  await search.press('Enter');
  await expect(page.locator('section[aria-labelledby="cart-title"]')).toContainText(name);
}

/** Opens the kitchen screen for one station and bumps the ticket of table 1. */
async function bumpTable1(page: Page, station: string, dishes: string[], notDishes: string[]) {
  await expect(page).toHaveURL(/\/kds/);
  await page.getByRole('button', { name: station, exact: true }).click();
  const ticket = page.locator('article').filter({ hasText: 'Tavolina 1' });
  await expect(ticket).toHaveCount(1);
  for (const dish of dishes) await expect(ticket).toContainText(dish);
  for (const dish of notDishes) await expect(ticket).not.toContainText(dish);
  await ticket.getByRole('button', { name: /^Shëno fletën \d+ gati$/ }).click();
  // The ticket moves to the "Gati" column.
  const ready = page.locator('section', { has: page.getByRole('heading', { name: /^Gati/ }) });
  await expect(ready.locator('article').filter({ hasText: 'Tavolina 1' })).toBeVisible();
}

test('waiter orders 3 items → stations bump → waiter sees ready and serves', async ({
  browser,
}) => {
  // Waiter opens free table 1 and orders: a beer for the bar, two dishes for the kitchen.
  const waiter = await signIn(browser, 'kamarier@lasvegas.test');
  await expect(waiter).toHaveURL(/\/floor/);
  await waiter.getByRole('button', { name: /^Tavolina 1: E lirë/ }).click();
  await waiter.getByRole('button', { name: 'Hap tavolinën' }).click();
  await waiter.getByRole('link', { name: 'Merr porosinë' }).click();
  await expect(waiter).toHaveURL(/\/floor\/sessions\/\d+$/);
  await expect(waiter.getByRole('heading', { name: 'Tavolina 1' })).toBeVisible();

  for (const dish of ['Birra Korça 0.5 l', 'Tavë kosi', 'Sallatë shqiptare']) {
    await addBySearch(waiter, dish);
  }
  await waiter.getByRole('button', { name: /^Dërgo 3 artikuj/ }).click();
  const ordered = waiter.locator('section[aria-labelledby="sent-title"]');
  await expect(ordered.getByText('Dërguar')).toHaveCount(3);

  // Each station sees only its own dishes and bumps the ticket.
  const kitchen = await signIn(browser, 'kuzhina@lasvegas.test');
  await bumpTable1(kitchen, 'Kuzhina', ['Tavë kosi', 'Sallatë shqiptare'], ['Birra Korça']);
  const bar = await signIn(browser, 'bar@lasvegas.test');
  await bumpTable1(bar, 'Bar', ['Birra Korça 0.5 l'], ['Tavë kosi']);

  // The waiter is told (live, no reload) and serves everything.
  await expect(waiter.getByText('Gati — tavolina 1').first()).toBeVisible();
  await expect(ordered.getByText('Gati', { exact: true })).toHaveCount(3);
  await waiter.getByRole('button', { name: 'Shërbe 3 gati' }).click();
  await expect(ordered.getByText('Shërbyer', { exact: true })).toHaveCount(3);

  // The finished ticket leaves the kitchen board.
  await expect(kitchen.locator('article').filter({ hasText: 'Tavolina 1' })).toHaveCount(0);
});
