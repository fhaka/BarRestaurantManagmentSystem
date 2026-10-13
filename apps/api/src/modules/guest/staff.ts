import {
  blockGuestSchema,
  type GuestSessionSummary,
  type Permission,
  type ServiceRequest,
} from '@tavolina/shared';
import { db } from '../../db/knex.js';
import { writeAudit, type ActorContext } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import { emitTableUpdated } from '../../realtime/server.js';
import { loadSession } from '../floor/sessions.js';
import * as orderRepo from '../orders/repo.js';

export interface StaffActor extends ActorContext {
  locationId: number;
  permissions: ReadonlySet<Permission>;
}

const iso = (v: unknown) => (v as Date).toISOString();

/** Open "call waiter" / bill requests of the location, oldest first. */
export async function listRequests(actor: StaffActor): Promise<ServiceRequest[]> {
  const rows = await db('service_requests as r')
    .join('tables as t', 't.id', 'r.table_id')
    .where({ 'r.location_id': actor.locationId, 'r.status': 'open' })
    .orderBy('r.created_at')
    .select(
      'r.id',
      'r.type',
      'r.table_id',
      't.name as table_name',
      'r.table_session_id',
      'r.created_at',
    );
  return rows.map((r) => ({
    id: Number(r.id),
    type: r.type,
    tableId: Number(r.table_id),
    tableName: String(r.table_name),
    tableSessionId: r.table_session_id === null ? null : Number(r.table_session_id),
    createdAt: iso(r.created_at),
  }));
}

export async function handleRequest(actor: StaffActor, id: number): Promise<void> {
  const request = await db('service_requests')
    .where({ id, location_id: actor.locationId })
    .first('table_id', 'status');
  if (!request) throw AppError.notFound('Request not found');
  if (request.status === 'open') {
    await db('service_requests')
      .where({ id })
      .update({ status: 'handled', handled_by: actor.userId, handled_at: db.fn.now(3) });
  }
  emitTableUpdated(actor.locationId, [Number(request.table_id)]);
}

/** Phones that ordered or asked for something at this table. */
export async function listGuestSessions(
  actor: StaffActor,
  sessionRef: string | number,
): Promise<GuestSessionSummary[]> {
  const session = await orderRepo.findSessionRow(db, actor.locationId, sessionRef);
  if (!session) throw AppError.notFound('Table session not found');
  const rows = await db('guest_sessions as g')
    .leftJoin('order_items as i', 'i.guest_session_id', 'g.id')
    .where('g.table_session_id', session.id)
    .groupBy('g.id', 'g.created_at', 'g.last_seen_at', 'g.lang', 'g.blocked')
    .orderBy('g.created_at')
    .select('g.id', 'g.created_at', 'g.last_seen_at', 'g.lang', 'g.blocked')
    .select(db.raw('COUNT(i.id) as item_count'));
  return rows.map((r) => ({
    id: Number(r.id),
    createdAt: iso(r.created_at),
    lastSeenAt: iso(r.last_seen_at),
    lang: r.lang ?? null,
    blocked: Boolean(r.blocked),
    itemCount: Number(r.item_count),
  }));
}

/** Stops (or allows again) orders and requests from one phone (plan §5.5 anti-abuse). */
export async function blockGuestSession(actor: StaffActor, id: number, raw: unknown) {
  const { blocked } = blockGuestSchema.parse(raw);
  const guest = await db('guest_sessions').where({ id, location_id: actor.locationId }).first();
  if (!guest) throw AppError.notFound('Guest not found');
  if (guest.table_session_id) await loadSession(actor, Number(guest.table_session_id));
  await db.transaction(async (trx) => {
    await trx('guest_sessions')
      .where({ id })
      .update({ blocked, blocked_by: blocked ? actor.userId : null });
    await writeAudit(
      actor,
      {
        action: blocked ? 'guest.blocked' : 'guest.unblocked',
        entityType: 'guest_session',
        entityId: id,
      },
      trx,
    );
  });
  emitTableUpdated(actor.locationId, [Number(guest.table_id)]);
}

/** Latest guest reviews of the location (the dashboard shows them in Phase 9). */
export async function listReviews(actor: StaffActor) {
  const rows = await db('reviews as r')
    .join('table_sessions as s', 's.id', 'r.table_session_id')
    .join('tables as t', 't.id', 's.table_id')
    .leftJoin('users as u', 'u.id', 's.waiter_id')
    .where('r.location_id', actor.locationId)
    .orderBy('r.created_at', 'desc')
    .limit(100)
    .select(
      'r.id',
      'r.rating',
      'r.comment',
      'r.created_at',
      't.name as table_name',
      'u.name as waiter_name',
    );
  return rows.map((r) => ({
    id: Number(r.id),
    rating: Number(r.rating),
    comment: r.comment ?? null,
    tableName: String(r.table_name),
    waiterName: r.waiter_name ?? null,
    createdAt: iso(r.created_at),
  }));
}
