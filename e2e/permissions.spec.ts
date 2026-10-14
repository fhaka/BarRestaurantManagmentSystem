import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

test('each role sees only its screens (plan §4)', async ({ browser }) => {
  const waiter = await signIn(browser, 'kamarier@lasvegas.test');
  await expect(waiter).toHaveURL(/\/floor/);
  const nav = waiter.getByRole('navigation').first();
  await expect(nav.getByRole('link', { name: 'Salla' })).toBeVisible();
  for (const hidden of ['Raportet', 'Magazina', 'Regjistri i veprimeve', 'Stafi', 'Cilësimet']) {
    await expect(nav.getByRole('link', { name: hidden })).toHaveCount(0);
  }
  // Typing the address does not help either.
  await waiter.goto('/reports');
  await expect(waiter.getByText('Nuk keni akses këtu')).toBeVisible();

  const kitchen = await signIn(browser, 'kuzhina@lasvegas.test');
  await expect(kitchen).toHaveURL(/\/kds/);
});
