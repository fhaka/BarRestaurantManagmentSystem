import type { Knex } from 'knex';
import {
  addItemsSchema,
  businessDate,
  canTransitionItem,
  checkModifierSelection,
  createOrderSchema,
  effectivePrice,
  fireCourseSchema,
  itemStatusSchema,
  isUnsent,
  repeatItemsSchema,
  rejectGuestItemsSchema,
  sendItemsSchema,
  serveItemsSchema,
  updateDraftItemSchema,
  voidItemSchema,
  type AdminMenu,
  type MenuItem,
  type NewOrderItem,
  type Order,
  type OrderItemStatus,
  type Permission,
  type StockLowData,
} from '@tavolina/shared';
import type { z } from 'zod';
import { db } from '../../db/knex.js';
import { AppError } from '../../lib/errors.js';
import { writeAudit, type ActorContext } from '../../lib/audit.js';
import { transactionWithRetry } from '../../lib/transaction.js';
import { emitTableUpdated } from '../../realtime/server.js';
import { consumeApproval } from '../approvals/service.js';
import { loadSession } from '../floor/sessions.js';
import * as locationRepo from '../locations/repo.js';
import * as menuRepo from '../menu/repo.js';
import { assertDayOpen, paidOnOrder } from '../billing/totals.js';
import { deductForItems, reverseForItems } from '../inventory/stock.js';
import { emitItemsChanged, emitItemsSent } from './events.js';
import * as repo from './repo.js';
import { refreshTickets } from './tickets.js';

export interface OrderActor extends ActorContext {
  locationId: number;
  permissions: ReadonlySet<Permission>;
}

type Tx = Knex | Knex.Transaction;
export type ParsedItem = z.output<typeof addItemsSchema>['items'][number];

/** Who added a line: a staff member, or a guest's phone (QR menu). */
export interface LineOrigin {
  userId: number | null;
  guestSessionId: number | null;
}

const now3 = (trx: Tx) => trx.fn.now(3);

// ---- Access --------------------------------------------------------------------------------------

export async function orderForActor(
  actor: OrderActor,
  ref: string | number,
  trx: Tx = db,
  lock = false,
) {
  const order = await repo.findOrderRow(trx, actor.locationId, ref, lock);
  if (!order) throw AppError.notFound('Order not found');
  // Dine-in orders follow the table's owner rule (own tables only, plan §4).
  if (order.tableSessionId) await loadSessionIfActive(actor, order.tableSessionId, trx);
  return order;
}

async function loadSessionIfActive(actor: OrderActor, sessionId: number, trx: Tx) {
  const session = await trx('table_sessions').where({ id: sessionId }).first('status');
  if (session && session.status !== 'closed') await loadSession(actor, sessionId, trx);
}

export function assertOpen(order: { status: string }) {
  if (order.status !== 'open')
    throw AppError.conflict('ORDER_CLOSED', 'This order is already closed.');
}

async function itemForActor(actor: OrderActor, ref: string | number, trx: Tx = db) {
  const isUuid = typeof ref === 'string' && ref.includes('-');
  const row = await trx('order_items as i')
    .join('orders as o', 'o.id', 'i.order_id')
    .where('o.location_id', actor.locationId)
    .where(isUuid ? { 'i.uuid': ref } : { 'i.id': Number(ref) })
    .forUpdate()
    .first('i.*', 'o.status as order_status', 'o.table_session_id');
  if (!row) throw AppError.notFound('Order item not found');
  return row;
}

// ---- Orders --------------------------------------------------------------------------------------

/** Creates an order. Idempotent on uuid; a dine-in order for a table that already has one returns it. */
export async function createOrder(actor: OrderActor, raw: unknown): Promise<Order> {
  const input = createOrderSchema.parse(raw);
  const existing = await db('orders').where({ uuid: input.uuid }).first('id', 'location_id');
  if (existing) {
    if (Number(existing.location_id) !== actor.locationId)
      throw AppError.conflict('CONFLICT', 'Order id already used.');
    return repo.loadOrder(db, Number(existing.id));
  }
  const location = await locationRepo.findLocation(actor.locationId);
  if (!location) throw AppError.notFound('Location not found');

  const id = await transactionWithRetry(async (trx) => {
    await assertDayOpen(trx, actor.locationId);
    let sessionId: number | null = null;
    if (input.type === 'dine_in') {
      const session = await repo.findSessionRow(trx, actor.locationId, input.tableSessionRef!);
      if (!session || session.status === 'closed')
        throw AppError.notFound('This table is not open.');
      await loadSession(actor, session.id, trx);
      sessionId = session.id;
      const open = await trx('orders')
        .where({ table_session_id: sessionId, status: 'open' })
        .forUpdate()
        .first('id');
      if (open) return Number(open.id);
    }
    const date = businessDate(new Date(), location.timezone);
    const [newId] = await trx('orders').insert({
      uuid: input.uuid,
      location_id: actor.locationId,
      table_session_id: sessionId,
      type: input.type,
      number: await repo.nextNumber(trx, actor.locationId, date, 'order'),
      business_date: date,
      customer_name: input.customerName ?? null,
      customer_phone: input.customerPhone ?? null,
      delivery_address: input.deliveryAddress ?? null,
      pickup_at: input.pickupAt ? new Date(input.pickupAt) : null,
      opened_by: actor.userId,
    });
    return Number(newId);
  });
  return repo.loadOrder(db, id);
}

export async function getOrder(actor: OrderActor, ref: string | number): Promise<Order> {
  const order = await orderForActor(actor, ref);
  return repo.loadOrder(db, order.id);
}

/** The open order of a table session, or null if nothing has been ordered yet. */
export async function getSessionOrder(
  actor: OrderActor,
  sessionRef: string | number,
): Promise<Order | null> {
  const session = await repo.findSessionRow(db, actor.locationId, sessionRef);
  if (!session) throw AppError.notFound('Table session not found');
  if (session.status !== 'closed') await loadSession(actor, session.id);
  const order = await repo.findOrderForSession(db, session.id);
  return order ? repo.loadOrder(db, order.id) : null;
}

export function listOpenOrders(actor: OrderActor) {
  return repo.listOpenOrders(db, actor.locationId);
}

// ---- Adding items --------------------------------------------------------------------------------

export interface PreparedLine {
  input: ParsedItem;
  parent: InsertRow;
  children: InsertRow[];
}

interface InsertRow {
  uuid: string;
  menuItemId: number | null;
  comboId: number | null;
  variantId: number | null;
  name: string;
  variantName: string | null;
  unitPriceMinor: number;
  priceRuleId: number | null;
  qty: number;
  stationId: number | null;
  /** VAT copied from the item's rate (or the default rate) when added. */
  taxRateBp: number;
  modifiers: { modifierId: number; name: string; priceDeltaMinor: number }[];
}

/** The item's VAT rate, else the location's default rate (20% if none is set up). */
export function taxRateFor(menu: AdminMenu, taxRateId: number | null): number {
  const rate =
    menu.taxRates.find((r) => r.id === taxRateId) ?? menu.taxRates.find((r) => r.isDefault);
  return rate?.rateBp ?? 2000;
}

const unavailable = (name: string) =>
  AppError.conflict('ITEM_UNAVAILABLE', `${name} is not available right now.`, { itemName: name });

function categoryChain(menu: AdminMenu, categoryId: number): number[] {
  const chain: number[] = [];
  let current = menu.categories.find((c) => c.id === categoryId);
  while (current && !chain.includes(current.id)) {
    chain.push(current.id);
    current = current.parentId
      ? menu.categories.find((c) => c.id === current!.parentId)
      : undefined;
  }
  return chain;
}

/** Checks a menu item and its options, and prices it at `at` (business rules 1 and 6). */
function prepareItem(
  menu: AdminMenu,
  timeZone: string,
  at: Date,
  menuItemId: number,
  variantId: number | null | undefined,
  modifierIds: number[],
  fixedUnitPrice?: number,
): Omit<InsertRow, 'uuid' | 'qty'> {
  const item: MenuItem | undefined = menu.items.find((i) => i.id === menuItemId);
  if (!item)
    throw new AppError(400, 'INVALID_REFERENCE', 'This item is not on the menu.', {
      field: 'menuItemId',
    });
  const outOfStock =
    item.outOfStockUntil !== null && new Date(item.outOfStockUntil).getTime() > at.getTime();
  if (!item.active || outOfStock) throw unavailable(item.name);

  let variant = null as MenuItem['variants'][number] | null;
  if (variantId) {
    variant = item.variants.find((v) => v.id === variantId) ?? null;
    if (!variant)
      throw new AppError(400, 'INVALID_REFERENCE', 'This size does not exist for the item.', {
        field: 'variantId',
      });
  } else if (item.variants.length && fixedUnitPrice === undefined) {
    throw new AppError(400, 'MODIFIERS_INVALID', `Choose a size for ${item.name}.`, {
      itemName: item.name,
      problems: [{ code: 'variantRequired' }],
    });
  }

  const groups = item.modifierGroupIds
    .map((id) => menu.modifierGroups.find((g) => g.id === id))
    .filter((g): g is NonNullable<typeof g> => Boolean(g))
    .map((g) => ({
      id: g.id,
      name: g.name,
      minSelect: g.minSelect,
      maxSelect: g.maxSelect,
      required: g.required,
      modifierIds: g.modifiers.filter((m) => m.active).map((m) => m.id),
    }));
  const problems = checkModifierSelection(groups, modifierIds);
  if (problems.length) {
    throw new AppError(400, 'MODIFIERS_INVALID', `Check the options for ${item.name}.`, {
      itemName: item.name,
      problems,
    });
  }
  const allModifiers = menu.modifierGroups.flatMap((g) => g.modifiers);
  const modifiers = modifierIds.map((id) => {
    const m = allModifiers.find((x) => x.id === id)!;
    return { modifierId: m.id, name: m.name, priceDeltaMinor: m.priceDeltaMinor };
  });

  let unitPriceMinor = fixedUnitPrice ?? variant?.priceMinor ?? item.priceMinor;
  let priceRuleId: number | null = null;
  if (fixedUnitPrice === undefined) {
    const deal = effectivePrice(
      unitPriceMinor,
      { itemId: item.id, categoryIds: categoryChain(menu, item.categoryId) },
      menu.priceRules,
      at,
      timeZone,
    );
    unitPriceMinor = deal.priceMinor;
    priceRuleId = deal.ruleId;
  }
  return {
    menuItemId: item.id,
    comboId: null,
    variantId: variant?.id ?? null,
    name: item.name,
    variantName: variant?.name ?? null,
    unitPriceMinor,
    priceRuleId,
    stationId: item.stationId,
    taxRateBp: taxRateFor(menu, item.taxRateId),
    modifiers,
  };
}

export function prepareLine(
  menu: AdminMenu,
  timeZone: string,
  at: Date,
  input: ParsedItem,
): PreparedLine {
  if (input.menuItemId !== undefined) {
    const prepared = prepareItem(
      menu,
      timeZone,
      at,
      input.menuItemId,
      input.variantId,
      input.modifierIds,
    );
    return { input, parent: { ...prepared, uuid: input.uuid, qty: input.qty }, children: [] };
  }
  const combo = menu.combos.find((c) => c.id === input.comboId);
  if (!combo || !combo.active) throw unavailable(combo?.name ?? 'Combo');
  const bySlot = new Map(input.comboSelections.map((s) => [s.slotId, s]));
  if (bySlot.size !== combo.slots.length || combo.slots.some((s) => !bySlot.has(s.id))) {
    throw new AppError(400, 'COMBO_INVALID', `Choose one dish for every part of ${combo.name}.`, {
      comboName: combo.name,
    });
  }
  let surcharge = 0;
  const children: InsertRow[] = combo.slots.map((slot, index) => {
    const choice = bySlot.get(slot.id)!;
    const option = slot.items.find((i) => i.menuItemId === choice.menuItemId);
    if (!option) {
      throw new AppError(400, 'COMBO_INVALID', `That dish is not part of ${slot.name}.`, {
        comboName: combo.name,
        slot: slot.name,
      });
    }
    surcharge += option.priceDeltaMinor;
    // Dishes inside a combo cost nothing on their own; only extra modifiers are charged.
    const prepared = prepareItem(
      menu,
      timeZone,
      at,
      choice.menuItemId,
      choice.variantId,
      choice.modifierIds,
      0,
    );
    return { ...prepared, uuid: deterministicChildUuid(input.uuid, index), qty: input.qty };
  });
  return {
    input,
    parent: {
      uuid: input.uuid,
      menuItemId: null,
      comboId: combo.id,
      variantId: null,
      name: combo.name,
      variantName: null,
      unitPriceMinor: combo.priceMinor + surcharge,
      priceRuleId: null,
      qty: input.qty,
      stationId: null,
      // A set menu is taxed at the default rate; its dishes are priced at 0.
      taxRateBp: taxRateFor(menu, null),
      modifiers: [],
    },
    children,
  };
}

/** Child uuids derive from the parent's, so replaying the same request inserts nothing new. */
function deterministicChildUuid(parent: string, index: number): string {
  const suffix = (parseInt(parent.slice(-4), 16) + index + 1)
    .toString(16)
    .padStart(4, '0')
    .slice(-4);
  return `${parent.slice(0, -4)}${suffix}`;
}

async function insertRow(
  trx: Tx,
  orderId: number,
  row: InsertRow,
  line: ParsedItem,
  origin: LineOrigin,
  status: OrderItemStatus,
  parentId: number | null,
): Promise<number> {
  const [id] = await trx('order_items').insert({
    uuid: row.uuid,
    order_id: orderId,
    parent_item_id: parentId,
    menu_item_id: row.menuItemId,
    combo_id: row.comboId,
    variant_id: row.variantId,
    name_snapshot: row.name,
    variant_name_snapshot: row.variantName,
    unit_price_minor: row.unitPriceMinor,
    price_rule_id: row.priceRuleId,
    qty: row.qty,
    seat: line.seat ?? null,
    course: line.course ?? null,
    notes: line.notes ?? null,
    status,
    station_id: row.stationId,
    tax_rate_bp: row.taxRateBp,
    source: origin.guestSessionId === null ? 'staff' : 'guest',
    added_by: origin.userId,
    guest_session_id: origin.guestSessionId,
  });
  if (row.modifiers.length) {
    await trx('order_item_modifiers').insert(
      row.modifiers.map((m) => ({
        order_item_id: id,
        modifier_id: m.modifierId,
        name_snapshot: m.name,
        price_delta_minor: m.priceDeltaMinor,
      })),
    );
  }
  return Number(id);
}

/**
 * Inserts prepared lines (and combo dishes) into an order. Lines whose uuid already exists are
 * replays (offline queue, double tap) and are skipped. Returns the new item ids.
 */
export async function insertLinesTx(
  trx: Tx,
  orderId: number,
  lines: PreparedLine[],
  origin: LineOrigin,
  status: OrderItemStatus,
): Promise<number[]> {
  const known = new Map(
    (
      await trx('order_items')
        .whereIn(
          'uuid',
          lines.map((l) => l.parent.uuid),
        )
        .select('uuid', 'order_id')
    ).map((r) => [r.uuid as string, Number(r.order_id)]),
  );
  const newIds: number[] = [];
  for (const line of lines) {
    const seenIn = known.get(line.parent.uuid);
    if (seenIn !== undefined) {
      if (seenIn !== orderId)
        throw AppError.conflict('CONFLICT', 'This item id belongs to another order.');
      continue;
    }
    const parentId = await insertRow(trx, orderId, line.parent, line.input, origin, status, null);
    newIds.push(parentId);
    for (const child of line.children) {
      newIds.push(await insertRow(trx, orderId, child, line.input, origin, status, parentId));
    }
  }
  return newIds;
}

async function addItemsToOrder(actor: OrderActor, orderId: number, raw: unknown): Promise<Order> {
  const input = addItemsSchema.parse(raw);
  const location = await locationRepo.findLocation(actor.locationId);
  const menu = await menuRepo.loadAdminMenu(db, actor.locationId);
  const at = new Date();
  const lines = input.items.map((item) => prepareLine(menu, location!.timezone, at, item));

  const sent = await transactionWithRetry(async (trx) => {
    const order = await repo.findOrderRow(trx, actor.locationId, orderId, true);
    assertOpen(order!);
    await assertDayOpen(trx, actor.locationId);
    const newIds = await insertLinesTx(
      trx,
      orderId,
      lines,
      { userId: actor.userId, guestSessionId: null },
      'draft',
    );
    const result =
      input.send && newIds.length
        ? await sendItemsTx(trx, actor.locationId, orderId, newIds, actor.userId)
        : null;
    await repo.recalcTotals(trx, orderId);
    return result;
  });
  if (sent) emitItemsSent(actor.locationId, orderId, sent);
  return repo.loadOrder(db, orderId);
}

export async function addItems(
  actor: OrderActor,
  orderRef: string | number,
  raw: unknown,
): Promise<Order> {
  const order = await orderForActor(actor, orderRef);
  assertOpen(order);
  const result = await addItemsToOrder(actor, order.id, raw);
  if (order.tableSessionId)
    emitTableUpdated(actor.locationId, await tableIdsOf(order.tableSessionId));
  return result;
}

/** Waiter screen entry point: adds to the table's order, creating it on the first round. */
export async function addSessionItems(
  actor: OrderActor,
  sessionRef: string | number,
  raw: unknown,
): Promise<Order> {
  const session = await repo.findSessionRow(db, actor.locationId, sessionRef);
  if (!session || session.status === 'closed') throw AppError.notFound('This table is not open.');
  const existing = await repo.findOrderForSession(db, session.id);
  const order =
    existing ??
    (await createOrder(actor, {
      uuid: crypto.randomUUID(),
      type: 'dine_in',
      tableSessionRef: session.id,
    }));
  return addItems(actor, order.id, raw);
}

async function tableIdsOf(sessionId: number): Promise<number[]> {
  return (await db('table_session_tables').where({ session_id: sessionId }).select('table_id')).map(
    (r) => Number(r.table_id),
  );
}

// ---- Sending -------------------------------------------------------------------------------------

export interface SentResult {
  stationIds: number[];
  ticketIds: number[];
  /** Ingredients that dropped below their minimum (sent to managers after commit). */
  lowStock?: (StockLowData | null)[];
}

/**
 * Sends items to their stations: drafts become sent, later courses are held until fired, and one
 * KDS ticket is created per station. Items without a station (e.g. bottled drinks the waiter takes
 * from the fridge) are ready at once.
 */
export async function sendItemsTx(
  trx: Tx,
  locationId: number,
  orderId: number,
  itemIds: number[],
  userId: number | null = null,
): Promise<SentResult> {
  const rows = await trx('order_items').whereIn('id', itemIds).where('order_id', orderId);
  const toSend = rows.filter((r) => isUnsent(r.status));
  if (!toSend.length) return { stationIds: [], ticketIds: [] };

  const courses = toSend.filter((r) => r.course !== null).map((r) => Number(r.course));
  const firstCourse = courses.length ? Math.min(...courses) : null;
  const order = await trx('orders').where({ id: orderId }).first('location_id', 'business_date');
  const date =
    typeof order.business_date === 'string'
      ? order.business_date
      : (order.business_date as Date).toISOString().slice(0, 10);

  const byStation = new Map<number, number[]>();
  for (const r of toSend) {
    const held = firstCourse !== null && r.course !== null && Number(r.course) > firstCourse;
    const isComboParent = r.combo_id !== null;
    const status = isComboParent ? 'sent' : r.station_id === null ? 'ready' : 'sent';
    await trx('order_items')
      .where({ id: r.id })
      .update({
        status,
        held,
        sent_at: now3(trx),
        ...(status === 'ready' ? { ready_at: now3(trx) } : {}),
      });
    if (r.station_id !== null) {
      const list = byStation.get(Number(r.station_id)) ?? [];
      list.push(Number(r.id));
      byStation.set(Number(r.station_id), list);
    }
  }

  const ticketIds: number[] = [];
  for (const [stationId, ids] of byStation) {
    const [ticketId] = await trx('kds_tickets').insert({
      location_id: locationId,
      order_id: orderId,
      station_id: stationId,
      number: await repo.nextNumber(trx, locationId, date, 'ticket'),
      business_date: date,
      status: 'new',
    });
    await trx('kds_ticket_items').insert(
      ids.map((id) => ({ ticket_id: ticketId, order_item_id: id })),
    );
    ticketIds.push(Number(ticketId));
  }
  await syncComboParents(trx, orderId);
  // Business rule 7: ingredients are booked out in the same transaction as the send.
  const location = await locationRepo.findLocation(locationId, trx as Knex);
  const lowStock =
    location?.settings.stockDeductOn === 'send'
      ? await deductForItems(
          trx,
          locationId,
          toSend.map((r) => Number(r.id)),
          userId,
        )
      : [];
  return { stationIds: [...byStation.keys()], ticketIds, lowStock };
}

export async function sendItems(
  actor: OrderActor,
  orderRef: string | number,
  raw: unknown,
): Promise<Order> {
  const input = sendItemsSchema.parse(raw ?? {});
  const order = await orderForActor(actor, orderRef);
  assertOpen(order);
  const result = await transactionWithRetry(async (trx) => {
    let q = trx('order_items')
      .where({ order_id: order.id })
      .whereIn('status', ['draft', 'pending_confirmation']);
    if (input.itemRefs) {
      const refs = input.itemRefs.map(String);
      q = q.where((w) =>
        w.whereIn('uuid', refs).orWhereIn(
          'id',
          refs.filter((r) => /^\d+$/.test(r)),
        ),
      );
    }
    const ids = (await q.select('id')).map((r) => Number(r.id));
    // Children of a combo go with their parent.
    const children = ids.length
      ? (await trx('order_items').whereIn('parent_item_id', ids).select('id')).map((r) =>
          Number(r.id),
        )
      : [];
    const sent = await sendItemsTx(
      trx,
      actor.locationId,
      order.id,
      [...new Set([...ids, ...children])],
      actor.userId,
    );
    await repo.recalcTotals(trx, order.id);
    return sent;
  });
  emitItemsSent(actor.locationId, order.id, result);
  if (order.tableSessionId)
    emitTableUpdated(actor.locationId, await tableIdsOf(order.tableSessionId));
  return repo.loadOrder(db, order.id);
}

/** "Fire" a held course: the kitchen can start it now. */
export async function fireCourse(
  actor: OrderActor,
  orderRef: string | number,
  raw: unknown,
): Promise<Order> {
  const { course } = fireCourseSchema.parse(raw);
  const order = await orderForActor(actor, orderRef);
  assertOpen(order);
  const { stationIds, tickets } = await db.transaction(async (trx) => {
    const held = await trx('order_items')
      .where({ order_id: order.id, held: true, course })
      .select('id', 'station_id');
    if (!held.length)
      throw AppError.conflict('ORDER_ITEM_STATE', 'Nothing is waiting in this course.');
    const ids = held.map((r) => Number(r.id));
    await trx('order_items').whereIn('id', ids).update({ held: false });
    // A ticket that was already bumped goes back on the line for the new course.
    const tickets = await refreshTickets(trx, ids);
    await writeAudit(
      actor,
      { action: 'order.course_fired', entityType: 'order', entityId: order.id, after: { course } },
      trx,
    );
    return {
      stationIds: [
        ...new Set(held.filter((r) => r.station_id !== null).map((r) => Number(r.station_id))),
      ],
      tickets,
    };
  });
  emitItemsSent(actor.locationId, order.id, {
    stationIds,
    ticketIds: tickets.map((t) => t.ticketId),
  });
  return repo.loadOrder(db, order.id);
}

// ---- Drafts --------------------------------------------------------------------------------------

const alreadySent = () =>
  AppError.conflict('ORDER_ITEM_ALREADY_SENT', 'This item was already sent; void it instead.');

export async function updateDraftItem(
  actor: OrderActor,
  ref: string | number,
  raw: unknown,
): Promise<Order> {
  const input = updateDraftItemSchema.parse(raw);
  const orderId = await db.transaction(async (trx) => {
    const item = await itemForActor(actor, ref, trx);
    if (item.table_session_id) await loadSessionIfActive(actor, Number(item.table_session_id), trx);
    if (!isUnsent(item.status)) throw alreadySent();
    await trx('order_items')
      .where({ id: item.id })
      .update({
        ...(input.qty !== undefined ? { qty: input.qty } : {}),
        ...(input.seat !== undefined ? { seat: input.seat } : {}),
        ...(input.course !== undefined ? { course: input.course } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      });
    if (input.qty !== undefined)
      await trx('order_items').where({ parent_item_id: item.id }).update({ qty: input.qty });
    await repo.recalcTotals(trx, Number(item.order_id));
    return Number(item.order_id);
  });
  return repo.loadOrder(db, orderId);
}

export async function deleteDraftItem(actor: OrderActor, ref: string | number): Promise<Order> {
  const orderId = await db.transaction(async (trx) => {
    const item = await itemForActor(actor, ref, trx);
    if (item.table_session_id) await loadSessionIfActive(actor, Number(item.table_session_id), trx);
    if (!isUnsent(item.status)) throw alreadySent();
    await trx('order_items').where({ parent_item_id: item.id }).delete();
    await trx('order_items').where({ id: item.id }).delete();
    await repo.recalcTotals(trx, Number(item.order_id));
    return Number(item.order_id);
  });
  return repo.loadOrder(db, orderId);
}

// ---- Status changes ------------------------------------------------------------------------------

/** A combo line takes the status of its dishes (the "slowest" one wins). */
export async function syncComboParents(trx: Tx, orderId: number): Promise<void> {
  const parents = await trx('order_items')
    .where({ order_id: orderId })
    .whereNotNull('combo_id')
    .select('id', 'status');
  for (const parent of parents) {
    if (isUnsent(parent.status) || parent.status === 'voided') continue;
    const children = (
      await trx('order_items').where({ parent_item_id: parent.id }).select('status')
    ).map((r) => r.status as OrderItemStatus);
    const live = children.filter((s) => s !== 'voided');
    const status: OrderItemStatus =
      live.length === 0
        ? 'voided'
        : live.every((s) => s === 'served')
          ? 'served'
          : live.every((s) => s === 'ready' || s === 'served')
            ? 'ready'
            : live.some((s) => s === 'preparing' || s === 'ready')
              ? 'preparing'
              : 'sent';
    if (status !== parent.status) {
      await trx('order_items')
        .where({ id: parent.id })
        .update({
          status,
          ...(status === 'ready' ? { ready_at: now3(trx) } : {}),
          ...(status === 'served' ? { served_at: now3(trx) } : {}),
        });
    }
  }
}

/** Kitchen screen: start or finish one item. */
export async function setItemStatus(
  actor: OrderActor,
  ref: string | number,
  raw: unknown,
): Promise<void> {
  const { status } = itemStatusSchema.parse(raw);
  const result = await db.transaction(async (trx) => {
    const item = await itemForActor(actor, ref, trx);
    if (item.combo_id !== null)
      throw AppError.conflict('ORDER_ITEM_STATE', 'Change the dishes of a combo, not the combo.');
    if (item.held)
      throw AppError.conflict('ORDER_ITEM_STATE', 'This course has not been fired yet.');
    if (!canTransitionItem(item.status, status)) {
      throw AppError.conflict(
        'ORDER_ITEM_STATE',
        `The item cannot go from ${item.status} to ${status}.`,
        {
          from: item.status,
          to: status,
        },
      );
    }
    await trx('order_items')
      .where({ id: item.id })
      .update({
        status,
        ...(status === 'preparing' ? { started_at: now3(trx) } : { ready_at: now3(trx) }),
      });
    await syncComboParents(trx, Number(item.order_id));
    const bumped = await refreshTickets(trx, [Number(item.id)]);
    return { orderId: Number(item.order_id), itemId: Number(item.id), bumped };
  });
  await emitItemsChanged(actor.locationId, result.orderId, [result.itemId], result.bumped);
}

/** Waiter marks ready items as served (all ready items when none are named). */
export async function serveItems(
  actor: OrderActor,
  orderRef: string | number,
  raw: unknown,
): Promise<Order> {
  const input = serveItemsSchema.parse(raw ?? {});
  const order = await orderForActor(actor, orderRef);
  const changed = await db.transaction(async (trx) => {
    let q = trx('order_items').where({ order_id: order.id, status: 'ready' }).whereNull('combo_id');
    if (input.itemRefs) {
      const refs = input.itemRefs.map(String);
      q = q.where((w) =>
        w.whereIn('uuid', refs).orWhereIn(
          'id',
          refs.filter((r) => /^\d+$/.test(r)),
        ),
      );
    }
    const ids = (await q.select('id')).map((r) => Number(r.id));
    // Serving a combo serves its ready dishes.
    if (input.itemRefs) {
      const parents = (
        await trx('order_items')
          .where({ order_id: order.id })
          .whereNotNull('combo_id')
          .where((w) =>
            w.whereIn('uuid', input.itemRefs!.map(String)).orWhereIn(
              'id',
              input.itemRefs!.map(String).filter((r) => /^\d+$/.test(r)),
            ),
          )
          .select('id')
      ).map((r) => Number(r.id));
      if (parents.length) {
        ids.push(
          ...(
            await trx('order_items')
              .whereIn('parent_item_id', parents)
              .where('status', 'ready')
              .select('id')
          ).map((r) => Number(r.id)),
        );
      }
    }
    if (!ids.length) return [];
    await trx('order_items')
      .whereIn('id', ids)
      .update({ status: 'served', served_at: now3(trx) });
    await syncComboParents(trx, order.id);
    await refreshTickets(trx, ids);
    return ids;
  });
  if (changed.length) await emitItemsChanged(actor.locationId, order.id, changed, []);
  return repo.loadOrder(db, order.id);
}

/**
 * Voids a sent item (business rule 3: reason required). Needs a manager's approval token when the
 * location requires it, unless the person voiding can approve themselves. Always audited with both
 * user ids. Waste for prepared items is recorded once inventory exists (Phase 7).
 */
export async function voidItem(
  actor: OrderActor,
  ref: string | number,
  raw: unknown,
): Promise<Order> {
  const input = voidItemSchema.parse(raw);
  const location = await locationRepo.findLocation(actor.locationId);
  const result = await db.transaction(async (trx) => {
    const item = await itemForActor(actor, ref, trx);
    if (item.table_session_id) await loadSessionIfActive(actor, Number(item.table_session_id), trx);
    assertOpen({ status: item.order_status });
    if (isUnsent(item.status)) {
      throw AppError.conflict('ORDER_ITEM_STATE', 'This item was not sent yet; just remove it.');
    }
    if (!canTransitionItem(item.status, 'voided')) {
      throw AppError.conflict('ORDER_ITEM_STATE', 'Served or voided items cannot be voided.', {
        status: item.status,
      });
    }
    const onPaidBill = await trx('bill_items as bi')
      .join('bills as b', 'b.id', 'bi.bill_id')
      .where('bi.order_item_id', item.id)
      .whereNot('b.status', 'open')
      .first('b.id');
    if (onPaidBill) {
      throw AppError.conflict('ITEM_PAID', 'This dish is on a paid bill; refund it instead.');
    }
    let approvedBy: number | null = null;
    if (location?.settings.voidRequiresApproval) {
      approvedBy = actor.permissions.has('approval.grant')
        ? actor.userId
        : await consumeApproval(trx, {
            token: input.approvalToken,
            locationId: actor.locationId,
            action: 'order_item.void',
            entityType: 'order_item',
            entityId: item.id,
          });
    }
    const ids = [Number(item.id)];
    if (item.combo_id !== null) {
      ids.push(
        ...(
          await trx('order_items')
            .where({ parent_item_id: item.id })
            .whereNotIn('status', ['served', 'voided'])
            .select('id')
        ).map((r) => Number(r.id)),
      );
    }
    // Business rule 3: booked-out ingredients come back, or become waste if the kitchen started.
    const before = await trx('order_items')
      .whereIn('id', ids)
      .where('stock_deducted', true)
      .select('id', 'status');
    const started = before
      .filter((r) => r.status === 'preparing' || r.status === 'ready')
      .map((r) => Number(r.id));
    const notStarted = before
      .filter((r) => !started.includes(Number(r.id)))
      .map((r) => Number(r.id));
    const wasteVoids = location?.settings.voidedPreparedIsWaste ?? true;
    await reverseForItems(
      trx,
      actor.locationId,
      wasteVoids ? notStarted : [...notStarted, ...started],
      false,
      input.reason,
      actor.userId,
    );
    if (wasteVoids)
      await reverseForItems(trx, actor.locationId, started, true, input.reason, actor.userId);
    await trx('order_items')
      .whereIn('id', ids)
      .update({
        status: 'voided',
        voided_at: now3(trx),
        void_reason: input.reason,
        voided_by: actor.userId,
        void_approved_by: approvedBy,
      });
    await syncComboParents(trx, Number(item.order_id));
    const bumped = await refreshTickets(trx, ids);
    await repo.recalcTotals(trx, Number(item.order_id));
    // A void may not take the order below what has already been paid.
    const total = Number(
      (await trx('orders').where({ id: item.order_id }).first('total_minor')).total_minor,
    );
    if (total < (await paidOnOrder(trx, Number(item.order_id)))) {
      throw AppError.conflict(
        'ORDER_HAS_PAYMENTS',
        'Part of this bill is already paid; refund it first.',
      );
    }
    await writeAudit(
      actor,
      {
        action: 'order_item.voided',
        entityType: 'order_item',
        entityId: item.id,
        before: {
          status: item.status,
          name: item.name_snapshot,
          qty: item.qty,
          unitPriceMinor: Number(item.unit_price_minor),
        },
        after: { reason: input.reason },
        approvedBy,
      },
      trx,
    );
    return { orderId: Number(item.order_id), ids, bumped };
  });
  await emitItemsChanged(actor.locationId, result.orderId, result.ids, result.bumped);
  return repo.loadOrder(db, result.orderId);
}

/** "Same again": copies items (re-priced now) and usually sends them straight away. */
export async function repeatItems(
  actor: OrderActor,
  orderRef: string | number,
  raw: unknown,
): Promise<Order> {
  const input = repeatItemsSchema.parse(raw);
  if (input.uuids.length !== input.itemRefs.length)
    throw AppError.badRequest('Give one new uuid per item.');
  const order = await orderForActor(actor, orderRef);
  assertOpen(order);
  const full = await repo.loadOrder(db, order.id);
  const menu = await menuRepo.loadAdminMenu(db, actor.locationId);
  const items: NewOrderItem[] = input.itemRefs.map((ref, index) => {
    const source = full.items.find((i) => String(i.id) === String(ref) || i.uuid === String(ref));
    if (!source || source.parentItemId !== null)
      throw AppError.notFound('Item not found in this order');
    const base = {
      uuid: input.uuids[index]!,
      qty: source.qty,
      seat: source.seat,
      notes: source.notes,
    };
    if (source.comboId !== null) {
      // Combo dishes are inserted in slot order, so their position maps back to the slot.
      const slots = menu.combos.find((c) => c.id === source.comboId)?.slots ?? [];
      const children = full.items.filter((i) => i.parentItemId === source.id);
      if (slots.length !== children.length) throw unavailable(source.name);
      return {
        ...base,
        comboId: source.comboId,
        comboSelections: children.map((c, slotIndex) => ({
          slotId: slots[slotIndex]!.id,
          menuItemId: c.menuItemId!,
          variantId: c.variantId,
          modifierIds: c.modifiers.map((m) => m.modifierId).filter((m): m is number => m !== null),
        })),
      };
    }
    return {
      ...base,
      menuItemId: source.menuItemId!,
      variantId: source.variantId,
      modifierIds: source.modifiers.map((m) => m.modifierId).filter((m): m is number => m !== null),
    };
  });
  return addItems(actor, order.id, { items, send: input.send });
}

export async function orderOfItem(actor: OrderActor, ref: string | number) {
  const item = await itemForActor(actor, ref);
  return { orderId: Number(item.order_id), itemId: Number(item.id) };
}

// ---- Guest orders (QR menu) ----------------------------------------------------------------------

/** Pending guest lines of an order (all, or the named ones), with their combo dishes. */
async function pendingGuestIds(trx: Tx, orderId: number, refs?: (string | number)[]) {
  const rows = await trx('order_items')
    .where({ order_id: orderId, status: 'pending_confirmation' })
    .select('id', 'uuid', 'parent_item_id');
  if (!refs) return rows.map((r) => Number(r.id));
  const wanted = new Set(refs.map(String));
  const parents = new Set(
    rows
      .filter((r) => wanted.has(String(r.id)) || wanted.has(String(r.uuid)))
      .map((r) => Number(r.id)),
  );
  return rows
    .filter((r) => parents.has(Number(r.id)) || parents.has(Number(r.parent_item_id)))
    .map((r) => Number(r.id));
}

/**
 * A waiter confirms what guests ordered from their phones: the lines go to the kitchen. A table
 * that guests opened themselves becomes this waiter's table.
 */
export async function confirmGuestItems(
  actor: OrderActor,
  orderRef: string | number,
  raw: unknown,
): Promise<Order> {
  const input = sendItemsSchema.parse(raw ?? {});
  const order = await orderForActor(actor, orderRef);
  assertOpen(order);
  const sent = await transactionWithRetry(async (trx) => {
    const ids = await pendingGuestIds(trx, order.id, input.itemRefs);
    if (!ids.length) throw AppError.conflict('ORDER_ITEM_STATE', 'No guest order is waiting.');
    if (order.tableSessionId) {
      await trx('table_sessions')
        .where({ id: order.tableSessionId })
        .whereNull('waiter_id')
        .update({ waiter_id: actor.userId });
    }
    const result = await sendItemsTx(trx, actor.locationId, order.id, ids, actor.userId);
    await repo.recalcTotals(trx, order.id);
    await writeAudit(
      actor,
      {
        action: 'order.guest_items_confirmed',
        entityType: 'order',
        entityId: order.id,
        after: { itemIds: ids },
      },
      trx,
    );
    return result;
  });
  emitItemsSent(actor.locationId, order.id, sent);
  if (order.tableSessionId)
    emitTableUpdated(actor.locationId, await tableIdsOf(order.tableSessionId));
  return repo.loadOrder(db, order.id);
}

/** A waiter turns down guest lines (e.g. a prank or a dish the table did not want). */
export async function rejectGuestItems(
  actor: OrderActor,
  orderRef: string | number,
  raw: unknown,
): Promise<Order> {
  const input = rejectGuestItemsSchema.parse(raw ?? {});
  const order = await orderForActor(actor, orderRef);
  assertOpen(order);
  await db.transaction(async (trx) => {
    const ids = await pendingGuestIds(trx, order.id, input.itemRefs);
    if (!ids.length) throw AppError.conflict('ORDER_ITEM_STATE', 'No guest order is waiting.');
    await trx('order_items')
      .whereIn('id', ids)
      .update({
        status: 'voided',
        voided_at: now3(trx),
        void_reason: input.reason ?? null,
        voided_by: actor.userId,
      });
    await writeAudit(
      actor,
      {
        action: 'order.guest_items_rejected',
        entityType: 'order',
        entityId: order.id,
        after: { itemIds: ids, reason: input.reason ?? null },
      },
      trx,
    );
  });
  if (order.tableSessionId)
    emitTableUpdated(actor.locationId, await tableIdsOf(order.tableSessionId));
  return repo.loadOrder(db, order.id);
}
