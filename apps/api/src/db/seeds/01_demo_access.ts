import type { Knex } from 'knex';
import { DEFAULT_LOCATION_SETTINGS, type RoleKey } from '@tavolina/shared';
import { hashSecret } from '../../lib/crypto.js';
import { truncateAppTables } from '../reset.js';

/**
 * Demo business: "Bar Restaurant Las Vegas", Tirana (D-013).
 * Credentials are documented in docs/SETUP.md. The .test domain can never receive mail.
 */
export const DEMO_PASSWORD = 'Tavolina2026!';

const DEMO_STAFF: { name: string; email: string | null; role: RoleKey; pin: string }[] = [
  { name: 'Arben Hoxha', email: 'pronar@lasvegas.test', role: 'owner', pin: '1111' },
  { name: 'Elira Shehu', email: 'menaxher@lasvegas.test', role: 'manager', pin: '2222' },
  { name: 'Klajdi Dervishi', email: 'kamarier@lasvegas.test', role: 'waiter', pin: '3001' },
  { name: 'Sara Leka', email: null, role: 'waiter', pin: '3002' },
  { name: 'Dritan Muça', email: null, role: 'waiter', pin: '3003' },
  { name: 'Anisa Gjoni', email: 'arka@lasvegas.test', role: 'cashier', pin: '4001' },
  { name: 'Ekrani Kuzhina', email: 'kuzhina@lasvegas.test', role: 'kitchen', pin: '5001' },
  { name: 'Ekrani Bar', email: 'bar@lasvegas.test', role: 'kitchen', pin: '5002' },
];

export async function seed(knex: Knex): Promise<void> {
  await truncateAppTables(knex);

  const [accountId] = await knex('owners_accounts').insert({
    company_name: 'Bar Restaurant Las Vegas',
    nipt: 'L00000001A',
    plan: 'trial',
    status: 'active',
  });

  const [locationId] = await knex('locations').insert({
    account_id: accountId,
    name: 'Bar Restaurant Las Vegas',
    address: 'Rruga e Durrësit, Tiranë',
    nipt: 'L00000001A',
    settings: JSON.stringify({
      ...DEFAULT_LOCATION_SETTINGS,
      receiptHeader: 'Bar Restaurant Las Vegas\nRruga e Durrësit, Tiranë',
      receiptFooter: 'Faleminderit! Ju mirëpresim përsëri.',
    }),
  });

  const roles = await knex('roles').select<{ id: number; key: RoleKey }[]>('id', 'key');
  const roleId = new Map(roles.map((r) => [r.key, r.id]));
  const passwordHash = await hashSecret(DEMO_PASSWORD);

  for (const person of DEMO_STAFF) {
    const [userId] = await knex('users').insert({
      account_id: accountId,
      name: person.name,
      email: person.email,
      password_hash: person.email ? passwordHash : null,
      pin_hash: await hashSecret(person.pin),
      lang: 'sq',
    });
    await knex('user_locations').insert({
      user_id: userId,
      location_id: locationId,
      role_id: roleId.get(person.role),
    });
  }
}
