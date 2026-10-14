import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

test('clocking in with a PIN on the shared device shows up in the hours', async ({ browser }) => {
  // The owner has no shifts in the demo, so the run does not depend on the time of day.
  const device = await signIn(browser, 'menaxher@lasvegas.test');
  // "Switch user" locks the device on the screen where staff pick their name.
  await device.getByRole('button', { name: 'Menuja e përdoruesit' }).last().click();
  await device.getByRole('menuitem', { name: 'Ndërro përdoruesin' }).click();
  await expect(device).toHaveURL(/\/lock/);
  await device.getByRole('radio', { name: 'Hyrje / dalje në punë' }).click();
  await device.getByRole('button', { name: /Arben Hoxha/ }).click();
  // The PIN pad also takes the keyboard.
  await device.keyboard.type('1111');
  await expect(device.getByText(/Arben, hyrja u regjistrua në/).first()).toBeVisible();
  await expect(device.getByRole('button', { name: /Arben Hoxha/ })).toContainText('Në punë');

  const manager = await signIn(browser, 'menaxher@lasvegas.test');
  await manager.goto('/staff?tab=hours');
  await expect(manager.getByRole('row').filter({ hasText: 'Arben Hoxha' })).toContainText(
    '1 pa dalje',
  );
});
