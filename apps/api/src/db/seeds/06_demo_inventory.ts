import type { Knex } from 'knex';
import { fromMilli, toMilli, type StockUnit } from '@tavolina/shared';
import { refreshItemCosts } from '../../modules/inventory/stock.js';

/**
 * Stock for Bar Restaurant Las Vegas (plan §14): ingredients with realistic Tirana wholesale
 * prices, recipes for the coffees, drinks and the main dishes, four suppliers, a purchase order
 * on its way, and sea bass running low so the alert shows.
 */

// [name, unit, category, stock, minimum, cost per whole unit in lek, supplier]
type IngredientSeed = [string, StockUnit, string, string, string, number, SupplierKey];
type SupplierKey = 'dairy' | 'coffee' | 'meat' | 'market' | 'drinks';

const SUPPLIERS: Record<SupplierKey, { name: string; contact: string; phone: string }> = {
  dairy: { name: 'Bulmetore Erzeni', contact: 'Gentian Kola', phone: '+355 69 201 1101' },
  coffee: { name: 'Kafe Durrësi shpk', contact: 'Ilir Meta', phone: '+355 69 201 1102' },
  meat: { name: 'Mishtore Tirana', contact: 'Arjan Brahimi', phone: '+355 69 201 1103' },
  market: { name: 'Tregu i Frutave', contact: 'Mira Lika', phone: '+355 69 201 1104' },
  drinks: { name: 'Pije Distribucion', contact: 'Ervin Zeka', phone: '+355 69 201 1105' },
};

const INGREDIENTS: IngredientSeed[] = [
  ['Kafe kokërr', 'kg', 'Bar', '6', '2', 2_400, 'coffee'],
  ['Qumësht i plotë', 'l', 'Bulmet', '24', '8', 120, 'dairy'],
  ['Krem i rrahur', 'l', 'Bulmet', '2', '0.5', 600, 'dairy'],
  ['Kakao', 'kg', 'Bar', '1.5', '0.5', 1_600, 'coffee'],
  ['Portokall', 'kg', 'Fruta dhe perime', '15', '5', 120, 'market'],
  ['Birra Korça 0.5 l', 'piece', 'Pije', '96', '24', 120, 'drinks'],
  ['Birra Tirana 0.33 l', 'piece', 'Pije', '72', '24', 90, 'drinks'],
  ['Ujë Glina 0.5 l', 'piece', 'Pije', '120', '36', 30, 'drinks'],
  ['Coca-Cola 0.33 l', 'piece', 'Pije', '60', '24', 70, 'drinks'],
  ['Mish qengji', 'kg', 'Mish dhe peshk', '8', '3', 1_300, 'meat'],
  ['Mish viçi', 'kg', 'Mish dhe peshk', '6', '2', 1_400, 'meat'],
  ['Mish i grirë', 'kg', 'Mish dhe peshk', '5', '2', 900, 'meat'],
  ['Pulë fileto', 'kg', 'Mish dhe peshk', '7', '2', 650, 'meat'],
  ['Levrek', 'kg', 'Mish dhe peshk', '1.2', '3', 1_200, 'market'],
  ['Kos', 'kg', 'Bulmet', '10', '3', 180, 'dairy'],
  ['Gjizë', 'kg', 'Bulmet', '4', '1.5', 500, 'dairy'],
  ['Djathë i bardhë', 'kg', 'Bulmet', '6', '2', 700, 'dairy'],
  ['Vezë', 'piece', 'Bulmet', '120', '30', 15, 'dairy'],
  ['Domate', 'kg', 'Fruta dhe perime', '12', '4', 120, 'market'],
  ['Kastravec', 'kg', 'Fruta dhe perime', '6', '2', 80, 'market'],
  ['Speca', 'kg', 'Fruta dhe perime', '6', '2', 150, 'market'],
  ['Qepë', 'kg', 'Fruta dhe perime', '10', '3', 60, 'market'],
  ['Ullinj', 'kg', 'Fruta dhe perime', '3', '1', 500, 'market'],
  ['Spinaq', 'kg', 'Fruta dhe perime', '4', '1', 150, 'market'],
  ['Petë byreku', 'kg', 'Thatë', '5', '2', 250, 'market'],
  ['Spageti', 'kg', 'Thatë', '8', '2', 200, 'market'],
  ['Miell', 'kg', 'Thatë', '20', '5', 70, 'market'],
  ['Oriz', 'kg', 'Thatë', '10', '3', 160, 'market'],
  ['Vaj ulliri', 'l', 'Thatë', '10', '3', 900, 'market'],
  ['Gjalpë', 'kg', 'Bulmet', '3', '1', 1_000, 'dairy'],
  ['Biskota trileçe', 'kg', 'Thatë', '2', '0.5', 600, 'market'],
  ['Arra', 'kg', 'Thatë', '2', '0.5', 1_200, 'market'],
];

// Menu item → [ingredient, quantity][]; per size where the item has sizes.
const RECIPES: Record<string, [string, string][]> = {
  Espresso: [['Kafe kokërr', '0.009']],
  Makiato: [
    ['Kafe kokërr', '0.009'],
    ['Qumësht i plotë', '0.04'],
  ],
  Kapuçino: [
    ['Kafe kokërr', '0.009'],
    ['Qumësht i plotë', '0.15'],
  ],
  Latte: [
    ['Kafe kokërr', '0.009'],
    ['Qumësht i plotë', '0.22'],
  ],
  'Kafe amerikane': [['Kafe kokërr', '0.009']],
  'Freddo espresso': [['Kafe kokërr', '0.018']],
  'Freddo kapuçino': [
    ['Kafe kokërr', '0.018'],
    ['Qumësht i plotë', '0.1'],
  ],
  'Çokollatë e ngrohtë': [
    ['Kakao', '0.03'],
    ['Qumësht i plotë', '0.2'],
  ],
  'Birra Korça 0.5 l': [['Birra Korça 0.5 l', '1']],
  'Birra Tirana 0.33 l': [['Birra Tirana 0.33 l', '1']],
  'Coca-Cola 0.33 l': [['Coca-Cola 0.33 l', '1']],
  'Tavë kosi': [
    ['Mish qengji', '0.25'],
    ['Kos', '0.25'],
    ['Vezë', '2'],
    ['Miell', '0.03'],
    ['Gjalpë', '0.02'],
  ],
  'Fërgesë Tirane': [
    ['Speca', '0.15'],
    ['Domate', '0.15'],
    ['Gjizë', '0.12'],
    ['Gjalpë', '0.015'],
  ],
  'Qofte të fërguara': [
    ['Mish i grirë', '0.2'],
    ['Qepë', '0.03'],
    ['Vezë', '1'],
    ['Vaj ulliri', '0.03'],
  ],
  'Pulë në skarë': [
    ['Pulë fileto', '0.25'],
    ['Vaj ulliri', '0.015'],
  ],
  'Levrek në skarë': [
    ['Levrek', '0.4'],
    ['Vaj ulliri', '0.02'],
  ],
  'Biftek viçi': [
    ['Mish viçi', '0.3'],
    ['Vaj ulliri', '0.015'],
    ['Gjalpë', '0.01'],
  ],
  'Sallatë shqiptare': [
    ['Domate', '0.15'],
    ['Kastravec', '0.1'],
    ['Qepë', '0.03'],
    ['Djathë i bardhë', '0.05'],
    ['Ullinj', '0.02'],
    ['Vaj ulliri', '0.015'],
  ],
  'Sallatë greke': [
    ['Domate', '0.15'],
    ['Kastravec', '0.1'],
    ['Speca', '0.05'],
    ['Djathë i bardhë', '0.08'],
    ['Ullinj', '0.03'],
    ['Vaj ulliri', '0.02'],
  ],
  'Speca me gjizë': [
    ['Speca', '0.2'],
    ['Gjizë', '0.1'],
    ['Vaj ulliri', '0.01'],
  ],
  'Spageti bolonjeze': [
    ['Spageti', '0.12'],
    ['Mish i grirë', '0.12'],
    ['Domate', '0.1'],
    ['Qepë', '0.02'],
    ['Vaj ulliri', '0.01'],
  ],
  'Byrek me spinaq': [
    ['Petë byreku', '0.12'],
    ['Spinaq', '0.12'],
    ['Gjizë', '0.04'],
    ['Vaj ulliri', '0.015'],
  ],
  Trileçe: [
    ['Qumësht i plotë', '0.12'],
    ['Vezë', '1'],
    ['Biskota trileçe', '0.04'],
    ['Krem i rrahur', '0.03'],
  ],
  Bakllava: [
    ['Petë byreku', '0.05'],
    ['Arra', '0.04'],
    ['Gjalpë', '0.02'],
  ],
};

// Item with sizes → size name → recipe.
const SIZED: Record<string, Record<string, [string, string][]>> = {
  'Lëng portokalli i freskët': {
    'Gotë e vogël': [['Portokall', '0.5']],
    'Gotë e madhe': [['Portokall', '0.75']],
  },
};

// Options on the coffees.
const MODIFIER_RECIPES: Record<string, [string, string][]> = {
  'Shot ekstra': [['Kafe kokërr', '0.009']],
  'Krem i rrahur': [['Krem i rrahur', '0.03']],
};

export async function seed(knex: Knex): Promise<void> {
  const location = await knex('locations').first<{ id: number }>('id');
  const manager = await knex('users')
    .where({ email: 'menaxher@lasvegas.test' })
    .first<{ id: number }>('id');
  if (!location || !manager) throw new Error('Run 01_demo_access first');
  const locationId = location.id;

  const supplierIds = {} as Record<SupplierKey, number>;
  for (const [key, s] of Object.entries(SUPPLIERS) as [
    SupplierKey,
    (typeof SUPPLIERS)[SupplierKey],
  ][]) {
    const [id] = await knex('suppliers').insert({ location_id: locationId, ...s });
    supplierIds[key] = id!;
  }

  const ingredientIds = new Map<string, number>();
  const openedAt = new Date(Date.now() - 2 * 24 * 60 * 60_000);
  for (const [name, unit, category, stock, min, lek, supplier] of INGREDIENTS) {
    const [id] = await knex('ingredients').insert({
      location_id: locationId,
      name,
      unit,
      category,
      stock_qty: stock,
      min_qty: min,
      cost_per_unit_minor: lek * 100,
      supplier_id: supplierIds[supplier],
    });
    ingredientIds.set(name, id!);
    // The ledger is the truth: opening stock is a movement too.
    await knex('stock_movements').insert({
      location_id: locationId,
      ingredient_id: id,
      type: 'count_adjust',
      qty: stock,
      unit_cost_minor: lek * 100,
      ref_type: 'opening',
      user_id: manager.id,
      created_at: openedAt,
    });
  }
  const ing = (name: string) => {
    const id = ingredientIds.get(name);
    if (!id) throw new Error(`Unknown ingredient ${name}`);
    return id;
  };
  const qty = (q: string) => fromMilli(toMilli(q));

  const items = await knex('menu_items')
    .where({ location_id: locationId })
    .select<{ id: number; name: string }[]>('id', 'name');
  const itemId = (name: string) => {
    const item = items.find((i) => i.name === name);
    if (!item) throw new Error(`Unknown menu item ${name}`);
    return item.id;
  };
  for (const [name, lines] of Object.entries(RECIPES)) {
    await knex('recipe_lines').insert(
      lines.map(([ingredient, q]) => ({
        menu_item_id: itemId(name),
        ingredient_id: ing(ingredient),
        qty: qty(q),
      })),
    );
  }
  for (const [name, sizes] of Object.entries(SIZED)) {
    const id = itemId(name);
    const variants = await knex('menu_item_variants')
      .where({ item_id: id })
      .select<{ id: number; name: string }[]>('id', 'name');
    for (const [size, lines] of Object.entries(sizes)) {
      const variant = variants.find((v) => v.name === size);
      if (!variant) throw new Error(`Unknown size ${size} of ${name}`);
      await knex('recipe_lines').insert(
        lines.map(([ingredient, q]) => ({
          menu_item_id: id,
          variant_id: variant.id,
          ingredient_id: ing(ingredient),
          qty: qty(q),
        })),
      );
    }
  }
  const modifiers = await knex('modifiers as m')
    .join('modifier_groups as g', 'g.id', 'm.group_id')
    .where('g.location_id', locationId)
    .select<{ id: number; name: string }[]>('m.id', 'm.name');
  for (const [name, lines] of Object.entries(MODIFIER_RECIPES)) {
    const mod = modifiers.find((m) => m.name === name);
    if (!mod) throw new Error(`Unknown option ${name}`);
    await knex('recipe_lines').insert(
      lines.map(([ingredient, q]) => ({
        modifier_id: mod.id,
        ingredient_id: ing(ingredient),
        qty: qty(q),
      })),
    );
  }
  await refreshItemCosts(
    knex,
    items.map((i) => i.id),
  );

  // Sea bass ran low, so a purchase order is already on its way (sent yesterday).
  const sentAt = new Date(Date.now() - 24 * 60 * 60_000);
  const [poId] = await knex('purchase_orders').insert({
    location_id: locationId,
    supplier_id: supplierIds.market,
    number: 1,
    status: 'sent',
    notes: 'Dorëzim në mëngjes para orës 09:00.',
    expected_at: new Date(Date.now() + 24 * 60 * 60_000).toISOString().slice(0, 10),
    created_by: manager.id,
    sent_at: sentAt,
    created_at: sentAt,
  });
  await knex('purchase_order_lines').insert([
    {
      purchase_order_id: poId,
      ingredient_id: ing('Levrek'),
      qty_ordered: '5.000',
      unit_cost_minor: 120_000,
    },
    {
      purchase_order_id: poId,
      ingredient_id: ing('Domate'),
      qty_ordered: '10.000',
      unit_cost_minor: 12_000,
    },
    {
      purchase_order_id: poId,
      ingredient_id: ing('Portokall'),
      qty_ordered: '20.000',
      unit_cost_minor: 11_000,
    },
  ]);
}
