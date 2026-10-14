import AxeBuilder from '@axe-core/playwright';
import { devices, expect, test, type Page } from '@playwright/test';
import { GUEST_PORT } from '../playwright.config';
import { dbQuery, qrToken, signIn } from './helpers';

/**
 * Phase 10 accessibility pass: axe (WCAG 2.1 A and AA) on every main screen, in Albanian, after
 * the page has loaded its data. Read-only, so it can run before the flow tests.
 */
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function scan(page: Page, name: string) {
  // Let animations settle and data arrive.
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(300);
  const result = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  const problems = result.violations.map(
    (v) =>
      `${name}: [${v.impact}] ${v.id} — ${v.help} (${v.nodes.length}×: ${v.nodes
        .slice(0, 3)
        .map((n) => n.target.join(' '))
        .join(' | ')})`,
  );
  return problems;
}

test('staff screens have no WCAG A/AA violations', async ({ browser }) => {
  test.setTimeout(240_000);
  const page = await signIn(browser, 'menaxher@lasvegas.test');
  const [session] = await dbQuery<{ id: number }>(
    "SELECT id FROM table_sessions WHERE status <> 'closed' ORDER BY id LIMIT 1",
  );
  const screens: [string, string][] = [
    ['dashboard', '/dashboard'],
    ['floor', '/floor'],
    ['floor list', '/floor?view=list'],
    ['orders', '/orders'],
    ['order', `/floor/sessions/${session!.id}`],
    ['bill', `/floor/sessions/${session!.id}/bill`],
    ['cashier', '/cashier'],
    ['reservations', '/reservations'],
    ['menu', '/menu'],
    ['inventory', '/inventory'],
    ['inventory recipes', '/inventory?tab=recipes'],
    ['reports', '/reports'],
    ['staff', '/staff'],
    ['staff schedule', '/staff?tab=schedule'],
    ['settings', '/settings'],
    ['audit', '/audit'],
  ];
  const problems: string[] = [];
  for (const [name, url] of screens) {
    await page.goto(url);
    await expect(page.locator('main')).toBeVisible();
    problems.push(...(await scan(page, name)));
  }
  // Two common dialogs.
  await page.goto('/reservations');
  await page.getByRole('button', { name: 'Rezervim i ri' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  problems.push(...(await scan(page, 'reservation dialog')));
  await page.goto('/inventory');
  await page.getByRole('button', { name: 'Përbërës i ri' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  problems.push(...(await scan(page, 'ingredient dialog')));
  // The shared-device lock screen and the sign-in page.
  await page.goto('/lock');
  problems.push(...(await scan(page, 'lock')));
  const signedOut = await (await browser.newContext()).newPage();
  await signedOut.goto('/login');
  problems.push(...(await scan(signedOut, 'login')));
  // The kitchen screen.
  const kitchen = await signIn(browser, 'kuzhina@lasvegas.test');
  await kitchen.goto('/kds');
  problems.push(...(await scan(kitchen, 'kds')));
  expect(problems, problems.join('\n')).toEqual([]);
});

test('guest pages have no WCAG A/AA violations', async ({ browser }) => {
  const phone = await (
    await browser.newContext({ ...devices['Pixel 7'], locale: 'sq-AL' })
  ).newPage();
  const problems: string[] = [];
  await phone.goto(`http://localhost:${GUEST_PORT}/t/${await qrToken('Salla', '3')}`);
  await expect(phone.getByRole('heading', { level: 1 })).toBeVisible();
  problems.push(...(await scan(phone, 'guest menu')));
  await phone.goto(`http://localhost:${GUEST_PORT}/book/1`);
  await expect(phone.getByRole('heading', { level: 1 })).toBeVisible();
  problems.push(...(await scan(phone, 'booking')));
  expect(problems, problems.join('\n')).toEqual([]);
});
