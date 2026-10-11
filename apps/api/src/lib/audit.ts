import type { Request } from 'express';
import type { Knex } from 'knex';
import { db as defaultDb } from '../db/knex.js';

/** Who/where an action came from; built from the request once and passed into services. */
export interface ActorContext {
  userId: number;
  accountId: number;
  locationId: number | null;
  deviceId: number | null;
  ip: string | null;
  requestId: string | null;
}

export function actorFromRequest(req: Request): ActorContext {
  if (!req.auth) throw new Error('actorFromRequest used before requireAuth');
  return {
    userId: req.auth.userId,
    accountId: req.auth.accountId,
    locationId: req.location?.id ?? null,
    deviceId: req.auth.deviceId,
    ip: req.ip ?? null,
    requestId: String(req.id),
  };
}

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | number | null;
  before?: unknown;
  after?: unknown;
  approvedBy?: number | null;
  /** Overrides the actor's location (e.g. creating a new location). */
  locationId?: number | null;
}

/**
 * Appends a row to audit_logs. Append-only: the app never updates or deletes these rows.
 * Pass the transaction so the audit row commits or rolls back with the change it describes.
 */
export async function writeAudit(
  actor: ActorContext,
  entry: AuditEntry,
  db: Knex = defaultDb,
): Promise<void> {
  await db('audit_logs').insert({
    account_id: actor.accountId,
    location_id: entry.locationId !== undefined ? entry.locationId : actor.locationId,
    user_id: actor.userId,
    action: entry.action,
    entity_type: entry.entityType,
    entity_id: entry.entityId == null ? null : String(entry.entityId),
    before: entry.before === undefined ? null : JSON.stringify(entry.before),
    after: entry.after === undefined ? null : JSON.stringify(entry.after),
    approved_by: entry.approvedBy ?? null,
    device_id: actor.deviceId,
    ip: actor.ip,
    request_id: actor.requestId,
  });
}
