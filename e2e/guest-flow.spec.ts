import { devices, expect, test } from '@playwright/test';
import { GUEST_PORT } from '../playwright.config';
import { qrToken, signIn } from './helpers';

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
  await expect(waiter.getByText('Porosia e klientit shkoi në kuzhinë').first()).toBeVisible();

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
