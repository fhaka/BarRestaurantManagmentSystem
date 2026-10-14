import {
  addDays,
  auditQuerySchema,
  zonedDateTime,
  type AuditLogEntry,
  type AuditLogPage,
  type Permission,
} from '@tavolina/shared';
import { db } from '../../db/knex.js';
import type { ActorContext } from '../../lib/audit.js';
import * as locationRepo from '../locations/repo.js';

export interface AuditActor extends ActorContext {
  locationId: number;
  permissions: ReadonlySet<Permission>;
}

/** LIKE treats % and _ as wildcards; a prefix filter must match them literally. */
const escapeLike = (v: string) => v.replace(/[%_\\]/g, (c) => `\\${c}`);
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const json = (v: unknown) => (typeof v === 'string' ? (JSON.parse(v) as unknown) : (v ?? null));

/**
 * Plan §5.14: the append-only audit log, read-only. A location sees its own rows and the
 * account-wide ones (staff and locations have no single location). Nothing here changes rows.
 */
const scoped = (actor: AuditActor) =>
  db('audit_logs as a')
    .where('a.account_id', actor.accountId)
    .where((q) => q.where('a.location_id', actor.locationId).orWhereNull('a.location_id'));

export async function listAuditLogs(actor: AuditActor, raw: unknown): Promise<AuditLogPage> {
  const q = auditQuerySchema.parse(raw);
  const tz = (await locationRepo.findLocation(actor.locationId))?.timezone ?? 'Europe/Tirane';
  const query = scoped(actor)
    .leftJoin('users as u', 'u.id', 'a.user_id')
    .leftJoin('users as ap', 'ap.id', 'a.approved_by')
    .leftJoin('devices as d', 'd.id', 'a.device_id')
    .orderBy('a.id', 'desc')
    .limit(q.limit + 1)
    .select('a.*', 'u.name as user_name', 'ap.name as approved_name', 'd.name as device_name');
  // Calendar days in the location's timezone.
  if (q.from) query.where('a.created_at', '>=', zonedDateTime(q.from, 0, tz));
  if (q.to) query.where('a.created_at', '<', zonedDateTime(addDays(q.to, 1), 0, tz));
  if (q.action) {
    if (q.action.endsWith('.')) query.where('a.action', 'like', `${escapeLike(q.action)}%`);
    else query.where('a.action', q.action);
  }
  if (q.userId) query.where('a.user_id', q.userId);
  if (q.entityType) query.where('a.entity_type', q.entityType);
  if (q.entityId) query.where('a.entity_id', q.entityId);
  if (q.approved === 'true') query.whereNotNull('a.approved_by');
  if (q.approved === 'false') query.whereNull('a.approved_by');
  if (q.before) query.where('a.id', '<', q.before);

  const rows = await query;
  const page = rows.slice(0, q.limit);
  return {
    rows: page.map((r): AuditLogEntry => ({
      id: Number(r.id),
      at: (r.created_at as Date).toISOString(),
      action: String(r.action),
      entityType: String(r.entity_type),
      entityId: r.entity_id ?? null,
      userId: num(r.user_id),
      userName: r.user_name ?? null,
      approvedById: num(r.approved_by),
      approvedByName: r.approved_name ?? null,
      deviceName: r.device_name ?? null,
      ip: r.ip ?? null,
      requestId: r.request_id ?? null,
      before: json(r.before),
      after: json(r.after),
    })),
    nextCursor: rows.length > q.limit ? Number(page.at(-1)!.id) : null,
  };
}

/** The filters' choices: actions and people that appear in this location's log. */
export async function auditFacets(actor: AuditActor) {
  const [actions, users] = await Promise.all([
    scoped(actor).distinct('a.action').orderBy('a.action').pluck('a.action'),
    scoped(actor)
      .join('users as u', 'u.id', 'a.user_id')
      .distinct('u.id', 'u.name')
      .orderBy('u.name')
      .select('u.id', 'u.name'),
  ]);
  return {
    actions: actions.map(String),
    users: users.map((u) => ({ id: Number(u.id), name: String(u.name) })),
  };
}
