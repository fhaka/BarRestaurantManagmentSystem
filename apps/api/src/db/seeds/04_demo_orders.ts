import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { businessDate, type OrderItemStatus } from '@tavolina/shared';
import { nextNumber, recalcTotals } from '../../modules/orders/repo.js';
import { ticketStatusFor } from '../../modules/orders/tickets.js';

/**
 * Demo orders for the live tables of 03_demo_floor, so the floor, the order screen and both
 * kitchen screens show a service in progress. Also adds the "Menu dreke" lunch combo.
 */
type Line = [
  name: string,
  qty: number,
  status: OrderItemStatus,
  course?: 1 | 2 | 3,
  held?: boolean,
];
interface Round {
  minutesAgo: number;
  lines: Line[];
}

const ORDERS: { tables: string; rounds: Round[] }[] = [
  {
    tables: 'Salla/2',
    rounds: [
      {
        minutesAgo: 22,
        lines: [
          ['Kapuçino', 1, 'served'],
          ['Ujë Glina', 1, 'served'],
        ],
      },
      {
        minutesAgo: 14,
        lines: [
          ['Tavë kosi', 1, 'preparing'],
          ['Sallatë shqiptare', 1, 'ready'],
        ],
      },
    ],
  },
  {
    tables: 'Salla/5',
    rounds: [
      {
        minutesAgo: 45,
        lines: [
          ['Birra Korça 0.5 l', 4, 'served'],
          ['Coca-Cola 0.33 l', 2, 'served'],
          ['Pjatë djathërash shqiptare', 1, 'served'],
          ['Fërgesë Tirane', 2, 'served'],
          ['Paidhaqe qengji', 2, 'served'],
          ['Qofte të fërguara', 2, 'served'],
        ],
      },
      {
        minutesAgo: 15,
        lines: [
          ['Trileçe', 3, 'served'],
          ['Espresso', 4, 'served'],
        ],
      },
    ],
  },
  {
    tables: 'Salla/7',
    rounds: [
      {
        minutesAgo: 4,
        lines: [
          ['Fërgesë Tirane', 1, 'sent'],
          ['Pulë në skarë', 2, 'sent'],
          ['Birra Tirana 0.33 l', 2, 'sent'],
          ['Raki rrushi', 1, 'sent'],
        ],
      },
    ],
  },
  {
    tables: 'Tarraca/T3',
    rounds: [
      {
        minutesAgo: 35,
        lines: [
          ['Limonadë shtëpie', 3, 'served'],
          ['Verë e kuqe Kallmet', 1, 'served'],
          ['Speca me gjizë', 2, 'served', 1],
          ['Sallatë greke', 2, 'served', 1],
          ['Biftek viçi', 2, 'sent', 2, true],
          ['Levrek në skarë', 1, 'sent', 2, true],
        ],
      },
      { minutesAgo: 12, lines: [['Freddo espresso', 2, 'ready']] },
    ],
  },
];

const TAKEAWAY: { customer: string; minutesAgo: number; lines: Line[] } = {
  customer: 'Besa',
  minutesAgo: 8,
  lines: [
    ['Byrek me spinaq', 2, 'preparing'],
    ['Kafe turke', 1, 'sent'],
  ],
};

const TIMESTAMP: Partial<Record<OrderItemStatus, string[]>> = {
  sent: ['sent_at'],
  preparing: ['sent_at', 'started_at'],
  ready: ['sent_at', 'started_at', 'ready_at'],
  served: ['sent_at', 'started_at', 'ready_at', 'served_at'],
};

export async function seed(knex: Knex): Promise<void> {
  const location = await knex('locations').first<{ id: number; timezone: string }>(
    'id',
    'timezone',
  );
  if (!location) throw new Error('Run 01_demo_access first');
  const locationId = location.id;
  const date = businessDate(new Date(), location.timezone);
  const items = await knex('menu_items')
    .where({ location_id: locationId })
    .select<{ id: number; name: string; price_minor: number; station_id: number | null }[]>(
      'id',
      'name',
      'price_minor',
      'station_id',
    );
  const item = (name: string) => {
    const found = items.find((i) => i.name === name);
    if (!found) throw new Error(`Demo menu has no "${name}"`);
    return found;
  };

  await seedLunchCombo(knex, locationId, item);

  async function addRound(orderId: number, addedBy: number, round: Round) {
    const at = new Date(Date.now() - round.minutesAgo * 60_000);
    const byStation = new Map<number, { id: number; status: OrderItemStatus; held: boolean }[]>();
    for (const [name, qty, status, course, held = false] of round.lines) {
      const menuItem = item(name);
      const times = Object.fromEntries((TIMESTAMP[status] ?? []).map((c) => [c, at]));
      const [id] = await knex('order_items').insert({
        uuid: randomUUID(),
        order_id: orderId,
        menu_item_id: menuItem.id,
        name_snapshot: menuItem.name,
        unit_price_minor: menuItem.price_minor,
        qty,
        course: course ?? null,
        held,
        status,
        station_id: menuItem.station_id,
        added_by: addedBy,
        added_at: at,
        ...times,
      });
      if (menuItem.station_id) {
        const list = byStation.get(menuItem.station_id) ?? [];
        list.push({ id: id!, status, held });
        byStation.set(menuItem.station_id, list);
      }
    }
    for (const [stationId, lines] of byStation) {
      const status = ticketStatusFor(lines);
      const [ticketId] = await knex('kds_tickets').insert({
        location_id: locationId,
        order_id: orderId,
        station_id: stationId,
        number: await nextNumber(knex, locationId, date, 'ticket'),
        business_date: date,
        status,
        created_at: at,
        started_at: status === 'new' ? null : at,
        bumped_at: status === 'ready' || status === 'done' ? at : null,
        done_at: status === 'done' ? at : null,
      });
      await knex('kds_ticket_items').insert(
        lines.map((l) => ({ ticket_id: ticketId, order_item_id: l.id })),
      );
    }
  }

  for (const o of ORDERS) {
    const [areaName, tableName] = o.tables.split('/');
    const session = await knex('table_session_tables as l')
      .join('tables as t', 't.id', 'l.table_id')
      .join('areas as a', 'a.id', 't.area_id')
      .join('table_sessions as s', 's.id', 'l.session_id')
      .where({ 'a.name': areaName, 't.name': tableName, 's.location_id': locationId })
      .first<{ id: number; waiter_id: number; opened_at: Date }>(
        's.id',
        's.waiter_id',
        's.opened_at',
      );
    if (!session) throw new Error(`No live session on ${o.tables}`);
    const [orderId] = await knex('orders').insert({
      uuid: randomUUID(),
      location_id: locationId,
      table_session_id: session.id,
      type: 'dine_in',
      number: await nextNumber(knex, locationId, date, 'order'),
      business_date: date,
      opened_by: session.waiter_id,
      created_at: session.opened_at,
    });
    for (const round of o.rounds) await addRound(orderId!, session.waiter_id, round);
    await recalcTotals(knex, orderId!);
  }

  const cashier = await knex('users')
    .where({ email: 'arka@lasvegas.test' })
    .first<{ id: number }>('id');
  if (cashier) {
    const [orderId] = await knex('orders').insert({
      uuid: randomUUID(),
      location_id: locationId,
      type: 'takeaway',
      number: await nextNumber(knex, locationId, date, 'order'),
      business_date: date,
      customer_name: TAKEAWAY.customer,
      opened_by: cashier.id,
    });
    await addRound(orderId!, cashier.id, {
      minutesAgo: TAKEAWAY.minutesAgo,
      lines: TAKEAWAY.lines,
    });
    await recalcTotals(knex, orderId!);
  }
}

/** Weekday lunch menu: a main, a drink and a coffee for 900 L. */
async function seedLunchCombo(
  knex: Knex,
  locationId: number,
  item: (name: string) => { id: number },
) {
  const category = await knex('menu_categories')
    .where({ location_id: locationId, name: 'Pjata kryesore' })
    .first<{ id: number }>('id');
  const [comboId] = await knex('combos').insert({
    location_id: locationId,
    category_id: category!.id,
    name: 'Menu dreke',
    description: 'Pjatë kryesore, pije dhe kafe',
    price_minor: 90_000,
  });
  await knex('translations').insert([
    { entity_type: 'combo', entity_id: comboId, field: 'name', lang: 'en', value: 'Lunch menu' },
    {
      entity_type: 'combo',
      entity_id: comboId,
      field: 'description',
      lang: 'en',
      value: 'Main course, drink and coffee',
    },
    { entity_type: 'combo', entity_id: comboId, field: 'name', lang: 'it', value: 'Menù pranzo' },
    {
      entity_type: 'combo',
      entity_id: comboId,
      field: 'description',
      lang: 'it',
      value: 'Piatto principale, bevanda e caffè',
    },
  ]);
  const slots: [string, [string, string], [string, number][]][] = [
    [
      'Pjata kryesore',
      ['Main course', 'Piatto principale'],
      [
        ['Tavë kosi', 0],
        ['Qofte të fërguara', 0],
        ['Pulë në skarë', 0],
        ['Spageti bolonjeze', 0],
        ['Biftek viçi', 40_000],
      ],
    ],
    [
      'Pija',
      ['Drink', 'Bevanda'],
      [
        ['Ujë Glina', 0],
        ['Coca-Cola 0.33 l', 0],
        ['Limonadë shtëpie', 10_000],
      ],
    ],
    [
      'Kafe',
      ['Coffee', 'Caffè'],
      [
        ['Espresso', 0],
        ['Makiato', 0],
      ],
    ],
  ];
  for (const [sort, [name, [en, it], options]] of slots.entries()) {
    const [slotId] = await knex('combo_slots').insert({ combo_id: comboId, name, sort });
    await knex('translations').insert([
      { entity_type: 'combo_slot', entity_id: slotId, field: 'name', lang: 'en', value: en },
      { entity_type: 'combo_slot', entity_id: slotId, field: 'name', lang: 'it', value: it },
    ]);
    await knex('combo_slot_items').insert(
      options.map(([itemName, delta], itemSort) => ({
        slot_id: slotId,
        menu_item_id: item(itemName).id,
        price_delta_minor: delta,
        sort: itemSort,
      })),
    );
  }
}
