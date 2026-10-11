import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { localParts, type GuestMenu } from '@tavolina/shared';
import { createApp } from '../../app.js';
import { db } from '../../db/knex.js';
import { as, login, resetAndSeed, type Fixture } from '../../test/fixtures.js';
import { buildGuestMenu } from './guest.js';

const app = createApp();
let fx: Fixture;
let manager: ReturnType<typeof as>;
let categoryId: number;

beforeEach(async () => {
  fx = await resetAndSeed();
  manager = as(app, await login(app, fx.users.manager.email), fx.locationId);
  const category = await manager.post('/api/v1/menu/categories').send({
    name: 'Kafe',
    translations: { en: { name: 'Coffee' }, it: { name: 'Caffè' } },
  });
  categoryId = category.body.id;
});

async function item(overrides: Record<string, unknown> = {}) {
  const res = await manager.post('/api/v1/menu/items').send({
    categoryId,
    stationId: null,
    name: 'Kapuçino',
    description: 'Me qumësht',
    priceMinor: 18_000,
    translations: {
      en: { name: 'Cappuccino', description: 'With milk' },
      it: { name: 'Cappuccino' },
    },
    ...overrides,
  });
  expect(res.status).toBe(201);
  return res.body as { id: number };
}

const guestMenu = (lang?: string, acceptLanguage?: string) => {
  const req = request(app)
    .get(`/api/v1/guest/locations/${fx.locationId}/menu`)
    .query(lang ? { lang } : {});
  if (acceptLanguage) req.set('Accept-Language', acceptLanguage);
  return req;
};

describe('GET /guest/locations/:id/menu', () => {
  it('is public and returns translated content', async () => {
    await item();
    const res = await guestMenu('en');
    expect(res.status).toBe(200);
    const menu: GuestMenu = res.body;
    expect(menu.lang).toBe('en');
    expect(menu.location).toMatchObject({ name: 'Test Bar Tirana', defaultLang: 'sq' });
    expect(menu.categories[0]).toMatchObject({ name: 'Coffee', availableNow: true });
    expect(menu.categories[0]!.items[0]).toMatchObject({
      name: 'Cappuccino',
      description: 'With milk',
      priceMinor: 18_000,
      regularPriceMinor: null,
    });
  });

  it('falls back to the main language per field', async () => {
    await item();
    const menu: GuestMenu = (await guestMenu('it')).body;
    // Italian name exists, Italian description does not.
    expect(menu.categories[0]!.items[0]).toMatchObject({
      name: 'Cappuccino',
      description: 'Me qumësht',
    });
  });

  it('uses Accept-Language, and the default for languages the location does not offer', async () => {
    await item();
    expect((await guestMenu(undefined, 'it-IT,it;q=0.9,en;q=0.8')).body.lang).toBe('it');
    expect((await guestMenu('de')).body.lang).toBe('sq');
    await db('locations')
      .where({ id: fx.locationId })
      .update({ settings: JSON.stringify({ languages: ['sq', 'en'] }) });
    expect((await guestMenu('it')).body.lang).toBe('sq');
  });

  it('hides inactive, staff-only and 86ed items, and empty categories', async () => {
    const visible = await item({ name: 'Espresso' });
    await item({ name: 'Joaktiv', active: false });
    await item({ name: 'Vetëm stafi', guestVisible: false });
    const sold = await item({ name: 'Mbaroi' });
    await manager.post(`/api/v1/menu/items/${sold.id}/out-of-stock`).send({ mode: 'indefinite' });
    await manager.post('/api/v1/menu/categories').send({ name: 'Bosh' });

    const menu: GuestMenu = (await guestMenu('sq')).body;
    expect(menu.categories.map((c) => c.name)).toEqual(['Kafe']);
    expect(menu.categories[0]!.items.map((i) => i.id)).toEqual([visible.id]);
  });

  it('applies a price rule that is active now, to the item and its variants', async () => {
    await item({
      variants: [
        { name: 'I vogël', priceMinor: 18_000 },
        { name: 'I madh', priceMinor: 25_000 },
      ],
    });
    await manager.post('/api/v1/menu/price-rules').send({
      name: 'Gjithmonë -20%',
      scope: 'category',
      scopeId: categoryId,
      type: 'percent',
      value: 2000,
    });
    const product = (await guestMenu('sq')).body.categories[0].items[0];
    expect(product).toMatchObject({ priceMinor: 14_400, regularPriceMinor: 18_000 });
    expect(product.variants.map((v: { priceMinor: number }) => v.priceMinor)).toEqual([
      14_400, 20_000,
    ]);
  });

  it('happy hour depends on Tirana time', async () => {
    await item();
    await manager.post('/api/v1/menu/price-rules').send({
      name: 'Happy hour',
      scope: 'category',
      scopeId: categoryId,
      type: 'fixed',
      value: 5_000,
      weekdayMask: 0b0011111,
      timeFrom: '17:00',
      timeTo: '19:00',
    });
    const wednesday1730 = new Date('2026-07-15T17:30:00+02:00');
    const wednesday2000 = new Date('2026-07-15T20:00:00+02:00');
    const during = await buildGuestMenu(fx.locationId, { lang: 'sq' }, wednesday1730);
    const after = await buildGuestMenu(fx.locationId, { lang: 'sq' }, wednesday2000);
    expect(during.categories[0]!.items[0]!.priceMinor).toBe(13_000);
    expect(after.categories[0]!.items[0]!.priceMinor).toBe(18_000);
  });

  it('marks categories outside their schedule as unavailable', async () => {
    await item();
    // A one-hour window that ends right before "now" in Tirana.
    const { minutes } = localParts(new Date(), 'Europe/Tirane');
    const hhmm = (m: number) => {
      const v = ((m % 1440) + 1440) % 1440;
      return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
    };
    await manager
      .patch(`/api/v1/menu/categories/${categoryId}`)
      .send({ availableFrom: hhmm(minutes - 120), availableTo: hhmm(minutes - 60) });
    const menu: GuestMenu = (await guestMenu('sq')).body;
    expect(menu.categories[0]!.availableNow).toBe(false);
  });

  it('returns 404 for an unknown location', async () => {
    const res = await request(app).get('/api/v1/guest/locations/999999/menu');
    expect(res.status).toBe(404);
  });
});
