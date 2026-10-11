import request from 'supertest';
import type { Express } from 'express';
import { DEFAULT_LOCATION_SETTINGS, type RoleKey, type AuthResponse } from '@tavolina/shared';
import { db } from '../db/knex.js';
import { truncateAppTables } from '../db/reset.js';
import { syncReferenceData } from '../db/sync-access.js';
import { hashSecret } from '../lib/crypto.js';
import { clearPermissionCache } from '../modules/auth/access-repo.js';

export const PASSWORD = 'Password123!';
export const PINS: Record<RoleKey, string> = {
  owner: '1111',
  manager: '2222',
  waiter: '3333',
  cashier: '4444',
  kitchen: '5555',
};

export interface Fixture {
  accountId: number;
  locationId: number;
  users: Record<RoleKey, { id: number; email: string }>;
}

/** Empties the test database and creates one account, one location and one user per role. */
export async function resetAndSeed(): Promise<Fixture> {
  await truncateAppTables(db, { mode: 'delete' });
  await syncReferenceData(db);
  clearPermissionCache();

  const [accountId] = await db('owners_accounts').insert({ company_name: 'Test Bar' });
  const locationId = await createLocation(accountId!, 'Test Bar Tirana');

  const roles = await db('roles').select<{ id: number; key: RoleKey }[]>('id', 'key');
  const passwordHash = await hashSecret(PASSWORD);
  const users = {} as Fixture['users'];
  for (const role of roles) {
    const email = `${role.key}@test.test`;
    const [id] = await db('users').insert({
      account_id: accountId,
      name: `Test ${role.key}`,
      email,
      password_hash: passwordHash,
      pin_hash: await hashSecret(PINS[role.key]),
    });
    await db('user_locations').insert({ user_id: id, location_id: locationId, role_id: role.id });
    users[role.key] = { id: id!, email };
  }
  return { accountId: accountId!, locationId, users };
}

export async function createLocation(accountId: number, name: string): Promise<number> {
  const [id] = await db('locations').insert({
    account_id: accountId,
    name,
    settings: JSON.stringify(DEFAULT_LOCATION_SETTINGS),
  });
  return id!;
}

export interface Session {
  token: string;
  cookie: string;
  body: AuthResponse;
}

/** Signs in with email + password and returns the access token and refresh cookie. */
export async function login(app: Express, email: string, password = PASSWORD): Promise<Session> {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password });
  if (res.status !== 200)
    throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { token: res.body.accessToken, cookie: refreshCookie(res), body: res.body };
}

/** Extracts "tav_rt=…" from a response's Set-Cookie header. */
export function refreshCookie(res: request.Response): string {
  const header = res.headers['set-cookie'] as unknown as string[] | string | undefined;
  const cookies = Array.isArray(header) ? header : header ? [header] : [];
  const cookie = cookies.find((c) => c.startsWith('tav_rt='));
  return cookie ? cookie.split(';')[0]! : '';
}

/** Supertest agent helpers with auth + location headers. */
export function as(app: Express, session: Session, locationId?: number) {
  const headers = (r: request.Test) => {
    r.set('Authorization', `Bearer ${session.token}`);
    if (locationId) r.set('X-Location-Id', String(locationId));
    return r;
  };
  return {
    get: (url: string) => headers(request(app).get(url)),
    post: (url: string) => headers(request(app).post(url)),
    patch: (url: string) => headers(request(app).patch(url)),
    delete: (url: string) => headers(request(app).delete(url)),
  };
}
