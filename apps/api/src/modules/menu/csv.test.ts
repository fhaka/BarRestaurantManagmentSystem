import { beforeEach, describe, expect, it } from 'vitest';
import Papa from 'papaparse';
import type { AdminMenu } from '@tavolina/shared';
import { createApp } from '../../app.js';
import { db } from '../../db/knex.js';
import { as, login, resetAndSeed, type Fixture } from '../../test/fixtures.js';

const app = createApp();
let fx: Fixture;
let manager: ReturnType<typeof as>;

beforeEach(async () => {
  fx = await resetAndSeed();
  manager = as(app, await login(app, fx.users.manager.email), fx.locationId);
  await manager.post('/api/v1/stations').send({ name: 'Bar', type: 'bar' });
  await as(app, await login(app, fx.users.owner.email), fx.locationId)
    .post('/api/v1/tax-rates')
    .send({ name: 'TVSH 20%', rateBp: 2000, isDefault: true });
});

const CSV = [
  'category,name,name_en,name_it,price,station,allergens,tags,popular',
  'Kafe,Espresso,Espresso,Espresso,100,Bar,,vegan,1',
  'Kafe,Kapuçino,Cappuccino,Cappuccino,"1 80,00",Bar,milk,vegetarian,0',
  'Birra,Birra Korça,Korça beer,Birra Korça,250,Bar,gluten,,yes',
].join('\n');

const menu = async (): Promise<AdminMenu> => (await manager.get('/api/v1/menu')).body;

describe('CSV import', () => {
  it('dry run reports what would change and writes nothing', async () => {
    const res = await manager.post('/api/v1/menu/import').send({ csv: CSV });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      dryRun: true,
      created: 3,
      updated: 0,
      categoriesCreated: 2,
      errors: [],
    });
    expect((await menu()).items).toHaveLength(0);
  });

  it('applies rows, creates categories, and updates matching items on re-import', async () => {
    await manager.post('/api/v1/menu/import').send({ csv: CSV, dryRun: false }).expect(200);
    let m = await menu();
    expect(m.categories.map((c) => c.name)).toEqual(['Kafe', 'Birra']);
    const kapucino = m.items.find((i) => i.name === 'Kapuçino')!;
    expect(kapucino).toMatchObject({
      priceMinor: 18_000,
      allergens: ['milk'],
      tags: ['vegetarian'],
      translations: { en: { name: 'Cappuccino' } },
      stationId: m.stations[0]!.id,
      taxRateId: m.taxRates[0]!.id,
    });
    expect(m.items.find((i) => i.name === 'Birra Korça')!.isPopular).toBe(true);

    const update = 'category,name,price\nKafe,Kapuçino,200';
    const res = await manager.post('/api/v1/menu/import').send({ csv: update, dryRun: false });
    expect(res.body).toMatchObject({ created: 0, updated: 1 });
    m = await menu();
    const updated = m.items.find((i) => i.name === 'Kapuçino')!;
    expect(updated.priceMinor).toBe(20_000);
    // Columns not in the file are left alone.
    expect(updated.allergens).toEqual(['milk']);
    expect(updated.translations.en?.name).toBe('Cappuccino');
    expect(await db('audit_logs').where({ action: 'menu.price_changed' })).toHaveLength(1);
  });

  it('reports every bad row with row numbers and applies nothing', async () => {
    const bad = [
      'category,name,price,station,allergens',
      'Kafe,Espresso,100,Bar,',
      'Kafe,,abc,Kuzhina,pollen',
    ].join('\n');
    const res = await manager.post('/api/v1/menu/import').send({ csv: bad, dryRun: false });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('IMPORT_INVALID');
    expect(res.body.error.details.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ row: 3, column: 'name' }),
        expect.objectContaining({ row: 3, column: 'price' }),
        expect.objectContaining({ row: 3, column: 'station' }),
        expect.objectContaining({ row: 3, column: 'allergens' }),
      ]),
    );
    expect((await menu()).items).toHaveLength(0);
  });

  it('requires the category, name and price columns', async () => {
    const res = await manager.post('/api/v1/menu/import').send({ csv: 'name\nEspresso' });
    expect(res.status).toBe(422);
    expect(res.body.error.details.errors.map((e: { column: string }) => e.column)).toEqual([
      'category',
      'price',
    ]);
  });
});

describe('CSV export', () => {
  it('exports every item with translations, readable by the importer', async () => {
    await manager.post('/api/v1/menu/import').send({ csv: CSV, dryRun: false });
    const res = await manager.get('/api/v1/menu/export');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="?menu-/);
    const text = res.text.replace(/^\uFEFF/, '');
    const rows = Papa.parse<Record<string, string>>(text, { header: true }).data;
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.name === 'Kapuçino')).toMatchObject({
      category: 'Kafe',
      name_en: 'Cappuccino',
      price: '180',
      allergens: 'milk',
      station: 'Bar',
      tax_rate: 'TVSH 20%',
    });

    // Round trip: importing the export changes nothing new.
    const again = await manager.post('/api/v1/menu/import').send({ csv: res.text });
    expect(again.body).toMatchObject({ created: 0, updated: 3, errors: [] });
  });

  it('is limited to people who can edit the menu', async () => {
    const waiter = as(app, await login(app, fx.users.waiter.email), fx.locationId);
    await waiter.get('/api/v1/menu/export').expect(403);
  });
});
