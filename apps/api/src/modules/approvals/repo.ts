import type { Knex } from 'knex';
import { db as defaultDb } from '../../db/knex.js';

export async function insertApproval(
  row: {
    tokenHash: string;
    locationId: number;
    action: string;
    entityType: string;
    entityId: string;
    requestedBy: number;
    approvedBy: number;
    expiresAt: Date;
  },
  db: Knex = defaultDb,
) {
  await db('approvals').insert({
    token_hash: row.tokenHash,
    location_id: row.locationId,
    action: row.action,
    entity_type: row.entityType,
    entity_id: row.entityId,
    requested_by: row.requestedBy,
    approved_by: row.approvedBy,
    expires_at: row.expiresAt,
  });
}

/**
 * Marks a matching, unused, unexpired approval as used in one statement, so a token can never
 * be consumed twice even under concurrency. Returns the approver id, or null if nothing matched.
 */
export async function consumeApproval(
  match: {
    tokenHash: string;
    locationId: number;
    action: string;
    entityType: string;
    entityId: string;
  },
  db: Knex = defaultDb,
): Promise<number | null> {
  const where = {
    token_hash: match.tokenHash,
    location_id: match.locationId,
    action: match.action,
    entity_type: match.entityType,
    entity_id: match.entityId,
  };
  const updated = await db('approvals')
    .where(where)
    .whereNull('used_at')
    .where('expires_at', '>', db.fn.now(3))
    .update({ used_at: db.fn.now(3) });
  if (updated !== 1) return null;
  const row = await db('approvals').where(where).first<{ approved_by: number }>('approved_by');
  return row?.approved_by ?? null;
}
