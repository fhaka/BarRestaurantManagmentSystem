import type { Knex } from 'knex';
import {
  APPROVAL_TTL_SECONDS,
  approvalRequestSchema,
  type ApprovalAction,
  type ApprovalResponse,
} from '@tavolina/shared';
import { db } from '../../db/knex.js';
import { AppError } from '../../lib/errors.js';
import { randomToken, sha256 } from '../../lib/crypto.js';
import { writeAudit, type ActorContext } from '../../lib/audit.js';
import * as accessRepo from '../auth/access-repo.js';
import * as authRepo from '../auth/repo.js';
import { verifyUserPin } from '../auth/pin.js';
import * as repo from './repo.js';

/**
 * A manager enters their PIN on the requester's device; the result is a single-use token
 * valid for 60 seconds, bound to one action on one entity at one location (plan §11).
 */
export async function createApproval(
  actor: ActorContext & { locationId: number },
  raw: unknown,
): Promise<ApprovalResponse> {
  const input = approvalRequestSchema.parse(raw);

  const approver = await authRepo.findUserById(input.approverId);
  const access = approver
    ? await accessRepo.findLocationAccess(approver.id, actor.locationId)
    : undefined;
  const canApprove =
    approver?.active &&
    approver.account_id === actor.accountId &&
    access &&
    (await accessRepo.getRolePermissions(access.roleId)).has('approval.grant');
  if (!approver || !canApprove) {
    throw new AppError(403, 'FORBIDDEN', 'This person cannot approve actions here.');
  }

  await verifyUserPin(approver, input.pin);

  const token = randomToken();
  const expiresAt = new Date(Date.now() + APPROVAL_TTL_SECONDS * 1000);
  await db.transaction(async (trx) => {
    await repo.insertApproval(
      {
        tokenHash: sha256(token),
        locationId: actor.locationId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        requestedBy: actor.userId,
        approvedBy: approver.id,
        expiresAt,
      },
      trx,
    );
    await writeAudit(
      actor,
      {
        action: 'approval.granted',
        entityType: input.entityType,
        entityId: input.entityId,
        after: { action: input.action },
        approvedBy: approver.id,
      },
      trx,
    );
  });

  return {
    approvalToken: token,
    expiresAt: expiresAt.toISOString(),
    approverId: approver.id,
    action: input.action,
  };
}

/**
 * Consumes an approval token for exactly this action and entity. Call inside the transaction
 * of the action it authorises. Returns the approving manager's id (for the audit log).
 */
export async function consumeApproval(
  trx: Knex | Knex.Transaction,
  match: {
    token: string | undefined;
    locationId: number;
    action: ApprovalAction;
    entityType: string;
    entityId: string | number;
  },
): Promise<number> {
  if (!match.token) {
    throw new AppError(403, 'APPROVAL_INVALID', 'A manager needs to approve this action.');
  }
  const approverId = await repo.consumeApproval(
    {
      tokenHash: sha256(match.token),
      locationId: match.locationId,
      action: match.action,
      entityType: match.entityType,
      entityId: String(match.entityId),
    },
    trx,
  );
  if (approverId === null) {
    throw new AppError(
      403,
      'APPROVAL_INVALID',
      'The approval expired or does not match this action. Ask a manager again.',
    );
  }
  return approverId;
}
