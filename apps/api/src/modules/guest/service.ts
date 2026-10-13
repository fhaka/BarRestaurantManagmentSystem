import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import {
  GUEST_ORDERS_PER_MINUTE,
  businessDate,
  guestOrderSchema,
  reviewSchema,
  inTimeWindow,
  isBillable,
  lineTotal,
  localParts,
  roomFor,
  serviceRequestSchema,
  weekdayInMask,
  type AdminMenu,
  type GuestOrderLine,
  type GuestTableInfo,
  type GuestTableState,
  type Location,
  type OrderItemStatus,
  type ServiceRequestType,
} from '@tavolina/shared';
import { db } from '../../db/knex.js';
import { randomToken, sha256 } from '../../lib/crypto.js';
import { AppError } from '../../lib/errors.js';
import { transactionWithRetry } from '../../lib/transaction.js';
import { emit, emitTableUpdated } from '../../realtime/server.js';
import * as floorRepo from '../floor/repo.js';
import * as locationRepo from '../locations/repo.js';
import * as menuRepo from '../menu/repo.js';
import { assertDayOpen } from '../billing/totals.js';
import { emitItemsSent } from '../orders/events.js';
import * as orderRepo from '../orders/repo.js';
import { insertLinesTx, prepareLine, sendItemsTx, type ParsedItem } from '../orders/service.js';

type Tx = Knex | Knex.Transaction;

/**
 * Guest QR ordering (plan §5.5). A guest is identified by the table's QR token plus a random
 * token in a cookie (one "guest session" per phone per table visit). No account, no JWT.
 */

export interface GuestTable {
  id: number;
  name: string;
  location: Location;
}

export interface GuestSessionRow {
  id: number;
  tableSessionId: number | null;
  blocked: boolean;
}

export async function resolveTable(tableToken: string): Promise<GuestTable> {
  const table = await floorRepo.findTableByToken(tableToken);
  const location = table?.active ? await locationRepo.findLocation(table.locationId) : undefined;
  if (!table || !table.active || !location) {
    throw AppError.notFound('This QR code is no longer valid. Ask the staff for help.');
  }
  return { id: table.id, name: table.name, location };
}

export function tableInfo(table: GuestTable): GuestTableInfo {
  const { settings } = table.location;
  return {
    location: {
      id: table.location.id,
      name: table.location.name,
      languages: settings.languages,
      defaultLang: settings.defaultLang,
    },
    table: { id: table.id, name: table.name },
    orderingEnabled: settings.guestOrderingEnabled,
    requiresConfirmation: settings.guestOrdersRequireConfirmation,
  };
}

const activeSessionId = async (tableId: number, trx: Tx = db) => {
  const row = await trx('table_session_tables').where({ table_id: tableId }).first('session_id');
  return row ? Number(row.session_id) : null;
};

/**
 * The phone's guest session for this table, if its cookie is valid. A cookie from another table,
 * or from the previous party at this table, does not count.
 */
export async function findGuestSession(
  table: GuestTable,
  cookieToken: string | undefined,
  trx: Tx = db,
): Promise<GuestSessionRow | null> {
  if (!cookieToken) return null;
  const row = await trx('guest_sessions')
    .where({ token_hash: sha256(cookieToken) })
    .first();
  if (!row || Number(row.table_id) !== table.id) return null;
  const current = await activeSessionId(table.id, trx);
  const bound = row.table_session_id === null ? null : Number(row.table_session_id);
  if (bound !== null && bound !== current) return null;
  return { id: Number(row.id), tableSessionId: bound, blocked: Boolean(row.blocked) };
}

/** Returns the phone's guest session, creating one (and a new cookie token) when needed. */
export async function ensureGuestSession(
  table: GuestTable,
  cookieToken: string | undefined,
  lang: string | undefined,
): Promise<{ session: GuestSessionRow; newToken: string | null }> {
  const existing = await findGuestSession(table, cookieToken);
  if (existing) {
    await db('guest_sessions')
      .where({ id: existing.id })
      .update({ last_seen_at: db.fn.now(3) });
    return { session: existing, newToken: null };
  }
  const token = randomToken(24);
  // The same phone's earlier visit at this table (e.g. the table just paid and closed).
  const previous = cookieToken
    ? await db('guest_sessions')
        .where({ token_hash: sha256(cookieToken), table_id: table.id })
        .first('id')
    : undefined;
  const [id] = await db('guest_sessions').insert({
    previous_id: previous?.id ?? null,
    location_id: table.location.id,
    table_id: table.id,
    table_session_id: await activeSessionId(table.id),
    token_hash: sha256(token),
    lang: lang?.slice(0, 5) ?? null,
  });
  return {
    session: { id: Number(id), tableSessionId: await activeSessionId(table.id), blocked: false },
    newToken: token,
  };
}

// ---- State -----------------------------------------------------------------------------------

export async function tableState(
  table: GuestTable,
  guest: GuestSessionRow | null,
): Promise<GuestTableState> {
  const sessionId = await activeSessionId(table.id);
  const session = sessionId
    ? await db('table_sessions').where({ id: sessionId }).first('status', 'opened_at')
    : null;
  const order = sessionId ? await orderRepo.findOrderForSession(db, sessionId) : undefined;
  const items = order ? await db('order_items').where({ order_id: order.id }).orderBy('id') : [];
  const mods = items.length
    ? await db('order_item_modifiers')
        .whereIn(
          'order_item_id',
          items.map((i) => i.id),
        )
        .select('order_item_id', 'modifier_id', 'name_snapshot', 'price_delta_minor')
    : [];
  const mine = (i: Record<string, unknown>) =>
    guest !== null && Number(i.guest_session_id) === guest.id;
  const lines: GuestOrderLine[] = items.map((i) => {
    const own = mods.filter((m) => Number(m.order_item_id) === Number(i.id));
    const status = i.status as OrderItemStatus;
    return {
      id: Number(i.id),
      uuid: String(i.uuid),
      menuItemId: i.menu_item_id === null ? null : Number(i.menu_item_id),
      comboId: i.combo_id === null ? null : Number(i.combo_id),
      variantId: i.variant_id === null ? null : Number(i.variant_id),
      modifierIds: own.map((m) => (m.modifier_id === null ? null : Number(m.modifier_id))),
      name: String(i.name_snapshot),
      variantName: i.variant_name_snapshot ?? null,
      modifiers: own.map((m) => String(m.name_snapshot)),
      qty: Number(i.qty),
      notes: i.notes ?? null,
      status,
      mine: mine(i),
      byStaff: i.guest_session_id === null,
      parentItemId: i.parent_item_id === null ? null : Number(i.parent_item_id),
      lineTotalMinor:
        status === 'voided'
          ? 0
          : lineTotal(
              Number(i.unit_price_minor),
              own.map((m) => Number(m.price_delta_minor)),
              Number(i.qty),
            ),
      addedAt: (i.added_at as Date).toISOString(),
    };
  });
  // Drafts on a waiter's device are not the guests' business.
  const visible = lines.filter((l) => l.status !== 'draft');
  const counted = (l: GuestOrderLine) =>
    isBillable(l.status) || l.status === 'pending_confirmation';
  const requests = await db('service_requests')
    .where({ table_id: table.id, status: 'open' })
    .orderBy('created_at')
    .select('type', 'created_at');
  return {
    session: session
      ? { status: session.status, openedAt: (session.opened_at as Date).toISOString() }
      : null,
    lines: visible,
    totalMinor: visible.filter(counted).reduce((sum, l) => sum + l.lineTotalMinor, 0),
    myTotalMinor: visible
      .filter((l) => l.mine && counted(l))
      .reduce((sum, l) => sum + l.lineTotalMinor, 0),
    openRequests: requests.map((r) => ({
      type: r.type as ServiceRequestType,
      createdAt: (r.created_at as Date).toISOString(),
    })),
    blocked: guest?.blocked ?? false,
    ...(await afterPayment(sessionId, guest?.id ?? null)),
  };
}

// ---- Ordering --------------------------------------------------------------------------------

const notNow = (name: string) =>
  AppError.conflict('ITEM_NOT_AVAILABLE_NOW', `${name} is not served at this time.`, {
    itemName: name,
  });
const notForGuests = (name: string) =>
  AppError.conflict('ITEM_UNAVAILABLE', `${name} is not available right now.`, { itemName: name });

/** Guests may only order what the guest menu shows: visible items, in their serving hours. */
function checkGuestAvailability(
  menu: AdminMenu,
  location: Location,
  items: ParsedItem[],
  at: Date,
) {
  const local = localParts(at, location.timezone);
  const categoryOpen = (categoryId: number): boolean => {
    const c = menu.categories.find((x) => x.id === categoryId);
    if (!c || !c.active) return false;
    const inHours =
      weekdayInMask(local.weekday, c.weekdayMask) &&
      inTimeWindow(local.minutes, c.availableFrom, c.availableTo);
    return inHours && (c.parentId === null || categoryOpen(c.parentId));
  };
  const checkItem = (id: number) => {
    const item = menu.items.find((i) => i.id === id);
    if (!item) return;
    if (!item.guestVisible) throw notForGuests(item.name);
    if (!categoryOpen(item.categoryId)) throw notNow(item.name);
  };
  for (const line of items) {
    if (line.menuItemId !== undefined) checkItem(line.menuItemId);
    if (line.comboId !== undefined) {
      const combo = menu.combos.find((c) => c.id === line.comboId);
      if (combo && !combo.guestVisible) throw notForGuests(combo.name);
      if (combo && !categoryOpen(combo.categoryId)) throw notNow(combo.name);
      for (const sel of line.comboSelections) checkItem(sel.menuItemId);
    }
  }
}

function isDuplicate(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === 'ER_DUP_ENTRY';
}

/**
 * Opens the table for guests when nobody is seated (no waiter yet; the first waiter to confirm
 * takes it). Returns the session id.
 */
async function sessionForOrdering(trx: Knex.Transaction, table: GuestTable): Promise<number> {
  const existing = await floorRepo.sessionIdForTable(table.id, trx);
  if (existing) {
    const s = await trx('table_sessions').where({ id: existing }).first('status');
    if (s.status === 'paid') {
      throw AppError.conflict('SESSION_STATE', 'This table has already paid. Ask the staff.');
    }
    return existing;
  }
  const [id] = await trx('table_sessions').insert({
    uuid: randomUUID(),
    location_id: table.location.id,
    table_id: table.id,
    waiter_id: null,
    guest_count: 1,
    status: 'open',
  });
  await trx('table_session_tables').insert({ session_id: id, table_id: table.id });
  await trx('tables').where({ id: table.id }).update({ needs_cleaning: false });
  return Number(id);
}

export async function placeOrder(
  table: GuestTable,
  guest: GuestSessionRow,
  raw: unknown,
): Promise<void> {
  const { location } = table;
  if (!location.settings.guestOrderingEnabled) {
    throw new AppError(
      403,
      'GUEST_ORDERING_DISABLED',
      'Ordering from the phone is turned off here.',
    );
  }
  if (guest.blocked) {
    throw new AppError(
      403,
      'GUEST_BLOCKED',
      'Ordering from this phone was stopped. Ask the staff.',
    );
  }
  const input = guestOrderSchema.parse(raw);
  // Business rule 8: at most 5 orders a minute from one phone.
  const recent = await db('guest_order_submissions')
    .where({ guest_session_id: guest.id })
    .where('created_at', '>', db.raw('NOW(3) - INTERVAL 1 MINUTE'))
    .count({ n: '*' })
    .first();
  if (Number(recent?.n ?? 0) >= GUEST_ORDERS_PER_MINUTE) {
    throw new AppError(429, 'TOO_MANY_ORDERS', 'Too many orders in a minute. Wait a moment.');
  }

  const menu = await menuRepo.loadAdminMenu(db, location.id);
  const at = new Date();
  checkGuestAvailability(menu, location, input.items, at);
  // Guests choose dishes only; seats and courses are the waiter's business.
  const lines = input.items.map((item) =>
    prepareLine(menu, location.timezone, at, { ...item, seat: null, course: null }),
  );
  const confirm = location.settings.guestOrdersRequireConfirmation;

  let attempt = 0;
  for (;;) {
    try {
      const result = await transactionWithRetry(async (trx) => {
        await assertDayOpen(trx, location.id);
        const sessionId = await sessionForOrdering(trx, table);
        // A phone that scanned before anyone sat down joins the party now.
        await trx('guest_sessions')
          .where({ id: guest.id })
          .whereNull('table_session_id')
          .update({ table_session_id: sessionId });
        let order = await trx('orders')
          .where({ table_session_id: sessionId, status: 'open' })
          .forUpdate()
          .first('id');
        if (!order) {
          const date = businessDate(at, location.timezone);
          const [orderId] = await trx('orders').insert({
            uuid: randomUUID(),
            location_id: location.id,
            table_session_id: sessionId,
            type: 'dine_in',
            number: await orderRepo.nextNumber(trx, location.id, date, 'order'),
            business_date: date,
            opened_by: null,
          });
          order = { id: orderId };
        }
        const orderId = Number(order.id);
        const ids = await insertLinesTx(
          trx,
          orderId,
          lines,
          { userId: null, guestSessionId: guest.id },
          confirm ? 'pending_confirmation' : 'draft',
        );
        const sent =
          !confirm && ids.length ? await sendItemsTx(trx, location.id, orderId, ids) : null;
        await trx('guest_order_submissions').insert({ guest_session_id: guest.id });
        await orderRepo.recalcTotals(trx, orderId);
        const waiter = await trx('table_sessions').where({ id: sessionId }).first('waiter_id');
        return {
          sessionId,
          orderId,
          sent,
          waiterId: waiter?.waiter_id === null ? null : Number(waiter.waiter_id),
          inserted: ids.length,
        };
      });
      const tableIds = (
        await db('table_session_tables').where({ session_id: result.sessionId }).select('table_id')
      ).map((r) => Number(r.table_id));
      if (result.sent) emitItemsSent(location.id, result.orderId, result.sent);
      if (confirm && result.inserted) {
        const names = (await orderRepo.tableNamesForSessions(db, [result.sessionId])).get(
          result.sessionId,
        );
        emit(
          'guest_order.pending',
          location.id,
          {
            orderId: result.orderId,
            tableSessionId: result.sessionId,
            tableNames: names ?? [table.name],
            waiterId: result.waiterId,
            itemCount: input.items.reduce((n, i) => n + (i.qty ?? 1), 0),
          },
          result.waiterId ? [roomFor.user(result.waiterId)] : [],
        );
      }
      emitTableUpdated(location.id, tableIds);
      return;
    } catch (err) {
      // Two phones opening the same free table at once: the second joins the first's session.
      if (isDuplicate(err) && attempt++ < 2) continue;
      throw err;
    }
  }
}

// ---- Requests --------------------------------------------------------------------------------

/** "Call the waiter" / "the bill please (cash or card)". Repeated taps reuse the open request. */
export async function createRequest(
  table: GuestTable,
  guest: GuestSessionRow,
  raw: unknown,
): Promise<void> {
  const { type } = serviceRequestSchema.parse(raw);
  if (guest.blocked) {
    throw new AppError(
      403,
      'GUEST_BLOCKED',
      'Requests from this phone were stopped. Ask the staff.',
    );
  }
  const sessionId = await activeSessionId(table.id);
  if (type !== 'call_waiter' && sessionId === null) {
    throw AppError.conflict('SESSION_STATE', 'Nothing has been ordered at this table yet.');
  }
  const open = await db('service_requests')
    .where({ table_id: table.id, type, status: 'open' })
    .first('id');
  if (open) return;

  const [id] = await db('service_requests').insert({
    location_id: table.location.id,
    table_id: table.id,
    table_session_id: sessionId,
    guest_session_id: guest.id,
    type,
  });
  let waiterId: number | null = null;
  if (sessionId) {
    const session = await db('table_sessions')
      .where({ id: sessionId })
      .first('waiter_id', 'status');
    waiterId = session?.waiter_id === null ? null : Number(session.waiter_id);
    if (type !== 'call_waiter' && session?.status === 'open') {
      await db('table_sessions').where({ id: sessionId }).update({ status: 'bill_requested' });
    }
  }
  emit(
    'service_request.created',
    table.location.id,
    {
      requestId: Number(id),
      type,
      tableId: table.id,
      tableName: table.name,
      tableSessionId: sessionId,
      waiterId,
    },
    waiterId ? [roomFor.user(waiterId)] : [],
  );
  const tableIds = sessionId
    ? (await db('table_session_tables').where({ session_id: sessionId }).select('table_id')).map(
        (r) => Number(r.table_id),
      )
    : [table.id];
  emitTableUpdated(table.location.id, tableIds);
}

// ---- After paying: receipts and reviews --------------------------------------------------------

/** How long after leaving a phone may still review its visit. */
const REVIEW_WINDOW_MS = 3 * 60 * 60 * 1000;

/**
 * The visit this phone may review: its current or previous table session, once that has paid
 * (or closed within the last few hours).
 */
async function reviewableVisit(guestId: number | null) {
  if (guestId === null) return null;
  const current = await db('guest_sessions')
    .where({ id: guestId })
    .first('id', 'table_session_id', 'previous_id');
  const candidates = [current];
  if (current?.previous_id) {
    candidates.push(
      await db('guest_sessions')
        .where({ id: current.previous_id })
        .first('id', 'table_session_id', 'previous_id'),
    );
  }
  for (const c of candidates) {
    if (!c?.table_session_id) continue;
    const s = await db('table_sessions')
      .where({ id: c.table_session_id })
      .first('status', 'closed_at');
    const recentlyClosed =
      s?.status === 'closed' &&
      s.closed_at &&
      Date.now() - (s.closed_at as Date).getTime() < REVIEW_WINDOW_MS;
    if (s && (s.status === 'paid' || recentlyClosed)) {
      return { guestSessionId: Number(c.id), tableSessionId: Number(c.table_session_id) };
    }
  }
  return null;
}

async function afterPayment(
  activeSessionId: number | null,
  guestId: number | null,
): Promise<Pick<GuestTableState, 'receipts' | 'review'>> {
  const visit = await reviewableVisit(guestId);
  const sessionIds = [
    ...new Set([activeSessionId, visit?.tableSessionId].filter((v): v is number => Boolean(v))),
  ];
  const bills = sessionIds.length
    ? await db('bills as b')
        .join('orders as o', 'o.id', 'b.order_id')
        .whereIn('o.table_session_id', sessionIds)
        .whereNot('b.status', 'open')
        .orderBy(['b.sort', 'b.id'])
        .select('b.label', 'b.split_type', 'b.total_minor', 'b.receipt_token')
    : [];
  let review: GuestTableState['review'] = null;
  if (visit) {
    const done = await db('reviews')
      .where({ table_session_id: visit.tableSessionId, guest_session_id: visit.guestSessionId })
      .first('id');
    review = done ? 'done' : 'available';
  }
  return {
    receipts: bills.map((b) => ({
      label: String(b.label),
      splitType: String(b.split_type),
      totalMinor: Number(b.total_minor),
      token: String(b.receipt_token),
    })),
    review,
  };
}

/** Guests rate their visit after paying; one review per phone per visit. */
export async function leaveReview(
  table: GuestTable,
  cookieToken: string | undefined,
  raw: unknown,
) {
  const input = reviewSchema.parse(raw);
  const row = cookieToken
    ? await db('guest_sessions')
        .where({ token_hash: sha256(cookieToken), table_id: table.id })
        .first('id')
    : undefined;
  const visit = await reviewableVisit(row ? Number(row.id) : null);
  if (!visit) throw AppError.conflict('SESSION_STATE', 'Reviews open once the table has paid.');
  try {
    await db('reviews').insert({
      location_id: table.location.id,
      table_session_id: visit.tableSessionId,
      guest_session_id: visit.guestSessionId,
      rating: input.rating,
      comment: input.comment?.trim() || null,
    });
  } catch (err) {
    if (isDuplicate(err))
      throw AppError.conflict('CONFLICT', 'You already reviewed this visit. Thank you!');
    throw err;
  }
}
