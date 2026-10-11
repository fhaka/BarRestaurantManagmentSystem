import { beforeEach, describe, expect, it } from 'vitest';
import type { AdminMenu, MenuItem } from '@tavolina/shared';
import { createApp } from '../../app.js';
import { db } from '../../db/knex.js';
import { as, login, resetAndSeed, type Fixture } from '../../test/fixtures.js';

const app = createApp();
let fx: Fixture;
let manager: ReturnType<typeof as>;
let setup: { stationId: number; taxRateId: number; categoryId: number };

beforeEach(async () => {
  fx = await resetAndSeed();
  manager = as(app, await login(app, fx.users.manager.email), fx.locationId);
  const station = await manager.post('/api/v1/stations').send({ name: 'Bar', type: 'bar' });
  const tax = await as(app, await login(app, fx.users.owner.email), fx.locationId)
    .post('/api/v1/tax-rates')
    .send({ name: 'TVSH 20%', rateBp: 2000, isDefault: true });
  const category = await manager
    .post('/api/v1/menu/categories')
    .send({ name: 'Kafe', translations: { en: { name: 'Coffee' }, it: { name: 'Caffè' } } });
  setup = { stationId: station.body.id, taxRateId: tax.body.id, categoryId: category.body.id };
});

const capuccino = () => ({
  categoryId: setup.categoryId,
  stationId: setup.stationId,
  name: 'Kapuçino',
  description: 'Me qumësht të shkumëzuar',
  priceMinor: 18_000,
  allergens: ['milk'],
  tags: ['vegetarian'],
  translations: {
    en: { name: 'Cappuccino' },
    it: { name: 'Cappuccino', description: 'Con latte' },
  },
  variants: [
    { name: 'I vogël', priceMinor: 18_000, translations: { en: { name: 'Small' } } },
    { name: 'I madh', priceMinor: 25_000 },
  ],
});

async function getMenu(session = manager): Promise<AdminMenu> {
  const res = await session.get('/api/v1/menu');
  expect(res.status).toBe(200);
  return res.body;
}

describe('categories', () => {
  it('creates with translations and a schedule, and lists in order', async () => {
    const res = await manager.post('/api/v1/menu/categories').send({
      name: 'Mëngjes',
      icon: 'croissant',
      availableFrom: '07:00',
      availableTo: '11:30',
      translations: { en: { name: 'Breakfast' } },
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      name: 'Mëngjes',
      availableFrom: '07:00',
      availableTo: '11:30',
      weekdayMask: 127,
      translations: { en: { name: 'Breakfast' } },
    });
    const menu = await getMenu();
    expect(menu.categories.map((c) => c.name)).toEqual(['Kafe', 'Mëngjes']);
  });

  it('rejects a schedule with only one end', async () => {
    const res = await manager
      .post('/api/v1/menu/categories')
      .send({ name: 'Bad', availableFrom: '07:00' });
    expect(res.status).toBe(400);
    expect(res.body.error.details.issues[0]).toMatchObject({
      path: 'availableTo',
      message: 'timeRange',
    });
  });

  it('reorders categories', async () => {
    const second = await manager.post('/api/v1/menu/categories').send({ name: 'Birra' });
    await manager
      .post('/api/v1/menu/categories/reorder')
      .send({ ids: [second.body.id, setup.categoryId] })
      .expect(204);
    expect((await getMenu()).categories.map((c) => c.name)).toEqual(['Birra', 'Kafe']);
  });

  it('refuses to delete a category that still has items', async () => {
    const item = await manager.post('/api/v1/menu/items').send(capuccino());
    const blocked = await manager.delete(`/api/v1/menu/categories/${setup.categoryId}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('CATEGORY_NOT_EMPTY');

    await manager.delete(`/api/v1/menu/items/${item.body.id}`).expect(204);
    await manager.delete(`/api/v1/menu/categories/${setup.categoryId}`).expect(204);
    expect((await getMenu()).categories).toHaveLength(0);
  });

  it('a waiter can read the menu but not change it', async () => {
    const waiter = as(app, await login(app, fx.users.waiter.email), fx.locationId);
    await waiter.get('/api/v1/menu').expect(200);
    const res = await waiter.post('/api/v1/menu/categories').send({ name: 'Nope' });
    expect(res.status).toBe(403);
  });
});

describe('items', () => {
  it('creates an item with variants, allergens, tags and translations', async () => {
    const res = await manager.post('/api/v1/menu/items').send(capuccino());
    expect(res.status).toBe(201);
    const item: MenuItem = res.body;
    expect(item).toMatchObject({
      name: 'Kapuçino',
      priceMinor: 18_000,
      stationId: setup.stationId,
      taxRateId: setup.taxRateId, // location default
      allergens: ['milk'],
      tags: ['vegetarian'],
      guestVisible: true,
      active: true,
      translations: {
        en: { name: 'Cappuccino' },
        it: { name: 'Cappuccino', description: 'Con latte' },
      },
    });
    expect(item.variants.map((v) => [v.name, v.priceMinor])).toEqual([
      ['I vogël', 18_000],
      ['I madh', 25_000],
    ]);
    expect(item.variants[0]!.translations).toEqual({ en: { name: 'Small' } });
  });

  it('updating variants keeps, edits, adds and removes by id', async () => {
    const { body: item } = await manager.post('/api/v1/menu/items').send(capuccino());
    const [small] = item.variants;
    const res = await manager.patch(`/api/v1/menu/items/${item.id}`).send({
      variants: [
        { id: small.id, name: 'I vogël', priceMinor: 19_000 },
        { name: 'Shumë i madh', priceMinor: 30_000 },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.variants.map((v: { id: number; name: string }) => v.name)).toEqual([
      'I vogël',
      'Shumë i madh',
    ]);
    expect(res.body.variants[0].id).toBe(small.id);
    expect(await db('menu_item_variants').where({ item_id: item.id })).toHaveLength(2);
  });

  it('audits price changes with before and after (business rule 9)', async () => {
    const { body: item } = await manager.post('/api/v1/menu/items').send(capuccino());
    await manager.patch(`/api/v1/menu/items/${item.id}`).send({ priceMinor: 20_000 }).expect(200);
    const audit = await db('audit_logs').where({ action: 'menu.price_changed' }).first();
    expect(audit).toMatchObject({ user_id: fx.users.manager.id, entity_id: String(item.id) });
    expect(audit.before.priceMinor).toBe(18_000);
    expect(audit.after.priceMinor).toBe(20_000);

    // Changing only the name is not a price change.
    await manager
      .patch(`/api/v1/menu/items/${item.id}`)
      .send({ name: 'Kapuçino i madh' })
      .expect(200);
    expect(await db('audit_logs').where({ action: 'menu.price_changed' })).toHaveLength(1);
  });

  it('rejects references to another location', async () => {
    const [otherAccount] = await db('owners_accounts').insert({ company_name: 'Other' });
    const [otherLocation] = await db('locations').insert({
      account_id: otherAccount,
      name: 'Other',
      settings: '{}',
    });
    const [foreignCategory] = await db('menu_categories').insert({
      location_id: otherLocation,
      name: 'X',
    });
    const res = await manager
      .post('/api/v1/menu/items')
      .send({ ...capuccino(), categoryId: foreignCategory });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({
      code: 'INVALID_REFERENCE',
      details: { field: 'categoryId' },
    });
  });

  it('validates input with field paths', async () => {
    const res = await manager
      .post('/api/v1/menu/items')
      .send({ ...capuccino(), priceMinor: -5, allergens: ['pollen'] });
    expect(res.status).toBe(400);
    const paths = res.body.error.details.issues.map((i: { path: string }) => i.path);
    expect(paths).toEqual(expect.arrayContaining(['priceMinor', 'allergens.0']));
  });

  it('hides cost prices from roles that cannot edit the menu', async () => {
    await manager.post('/api/v1/menu/items').send({ ...capuccino(), costMinor: 6_000 });
    expect((await getMenu()).items[0]!.costMinor).toBe(6_000);
    const waiter = as(app, await login(app, fx.users.waiter.email), fx.locationId);
    expect((await getMenu(waiter)).items[0]!.costMinor).toBeNull();
  });

  it('reorders items within a category', async () => {
    const a = await manager.post('/api/v1/menu/items').send(capuccino());
    const b = await manager.post('/api/v1/menu/items').send({ ...capuccino(), name: 'Makiato' });
    await manager
      .post(`/api/v1/menu/categories/${setup.categoryId}/items/reorder`)
      .send({ ids: [b.body.id, a.body.id] })
      .expect(204);
    expect((await getMenu()).items.map((i) => i.name)).toEqual(['Makiato', 'Kapuçino']);
  });
});

describe('out of stock (86)', () => {
  it('kitchen can 86 an item until 04:00 tomorrow and bring it back', async () => {
    const { body: item } = await manager.post('/api/v1/menu/items').send(capuccino());
    const kitchen = as(app, await login(app, fx.users.kitchen.email), fx.locationId);

    const off = await kitchen
      .post(`/api/v1/menu/items/${item.id}/out-of-stock`)
      .send({ mode: 'today' });
    expect(off.status).toBe(200);
    const until = new Date(off.body.outOfStockUntil);
    expect(until.getTime()).toBeGreaterThan(Date.now());
    expect(until.getTime() - Date.now()).toBeLessThanOrEqual(24 * 3_600_000);
    // 04:00 in Tirana is 02:00 or 03:00 UTC depending on DST.
    expect([2, 3]).toContain(until.getUTCHours());

    const back = await kitchen
      .post(`/api/v1/menu/items/${item.id}/out-of-stock`)
      .send({ mode: 'back' });
    expect(back.body.outOfStockUntil).toBeNull();
    expect(await db('audit_logs').where({ action: 'menu.availability_changed' })).toHaveLength(2);
  });

  it('waiters cannot 86 items', async () => {
    const { body: item } = await manager.post('/api/v1/menu/items').send(capuccino());
    const waiter = as(app, await login(app, fx.users.waiter.email), fx.locationId);
    const res = await waiter
      .post(`/api/v1/menu/items/${item.id}/out-of-stock`)
      .send({ mode: 'today' });
    expect(res.status).toBe(403);
  });
});

describe('modifier groups', () => {
  const milk = {
    name: 'Qumështi',
    minSelect: 1,
    maxSelect: 1,
    required: true,
    translations: { en: { name: 'Milk' } },
    modifiers: [
      { name: 'I plotë', priceDeltaMinor: 0 },
      { name: 'Tërshërë', priceDeltaMinor: 5_000, translations: { en: { name: 'Oat' } } },
    ],
  };

  it('creates a group and attaches it to an item', async () => {
    const group = await manager.post('/api/v1/menu/modifier-groups').send(milk);
    expect(group.status).toBe(201);
    expect(group.body.modifiers.map((m: { name: string }) => m.name)).toEqual([
      'I plotë',
      'Tërshërë',
    ]);
    const item = await manager
      .post('/api/v1/menu/items')
      .send({ ...capuccino(), modifierGroupIds: [group.body.id] });
    expect(item.body.modifierGroupIds).toEqual([group.body.id]);
  });

  it.each([
    [{ minSelect: 2, maxSelect: 1 }, 'minMax'],
    [{ required: true, minSelect: 0 }, 'requiredMin'],
    [{ maxSelect: 3 }, 'maxOptions'],
  ])('rejects inconsistent limits %j', async (patch, message) => {
    const res = await manager.post('/api/v1/menu/modifier-groups').send({ ...milk, ...patch });
    expect(res.status).toBe(400);
    expect(res.body.error.details.issues.map((i: { message: string }) => i.message)).toContain(
      message,
    );
  });

  it('deleting a group detaches it from items', async () => {
    const group = await manager.post('/api/v1/menu/modifier-groups').send(milk);
    const item = await manager
      .post('/api/v1/menu/items')
      .send({ ...capuccino(), modifierGroupIds: [group.body.id] });
    await manager.delete(`/api/v1/menu/modifier-groups/${group.body.id}`).expect(204);
    const menu = await getMenu();
    expect(menu.modifierGroups).toHaveLength(0);
    expect(menu.items.find((i) => i.id === item.body.id)!.modifierGroupIds).toEqual([]);
  });
});

describe('price rules', () => {
  it('creates a happy hour and rejects more than 100% off', async () => {
    const rule = {
      name: 'Happy hour',
      scope: 'category',
      scopeId: setup.categoryId,
      type: 'percent',
      value: 2000,
      weekdayMask: 0b0011111,
      timeFrom: '17:00',
      timeTo: '19:00',
    };
    const created = await manager.post('/api/v1/menu/price-rules').send(rule);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ value: 2000, timeFrom: '17:00', active: true });

    const tooMuch = await manager.post('/api/v1/menu/price-rules').send({ ...rule, value: 12_000 });
    expect(tooMuch.status).toBe(400);
  });
});
