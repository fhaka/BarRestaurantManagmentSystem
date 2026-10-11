import {
  canGrantRole,
  staffCreateSchema,
  staffCredentialsSchema,
  staffUpdateSchema,
  type Permission,
  type RoleKey,
  type StaffMember,
} from '@tavolina/shared';
import { db } from '../../db/knex.js';
import { AppError } from '../../lib/errors.js';
import { hashSecret } from '../../lib/crypto.js';
import { writeAudit, type ActorContext } from '../../lib/audit.js';
import * as accessRepo from '../auth/access-repo.js';
import * as authRepo from '../auth/repo.js';
import * as repo from './repo.js';

export interface StaffActor extends ActorContext {
  locationId: number;
  permissions: ReadonlySet<Permission>;
}

function assertCanGrant(actor: StaffActor, role: RoleKey) {
  if (!canGrantRole(actor.permissions, role)) {
    throw new AppError(403, 'ROLE_NOT_GRANTABLE', 'You cannot give someone this role.', {
      roleKey: role,
    });
  }
}

async function assertEmailFree(email: string | null | undefined, exceptUserId?: number) {
  if (email && (await repo.emailTaken(email, exceptUserId))) {
    throw AppError.conflict('EMAIL_TAKEN', 'Another account already uses this email.', {
      field: 'email',
    });
  }
}

/** Loads a staff member of the current location and checks the actor may manage them. */
async function loadManageable(actor: StaffActor, userId: number): Promise<StaffMember> {
  const member = await repo.findStaffMember(actor.locationId, userId);
  if (!member) throw AppError.notFound('This person does not work at this location.');
  // You may only manage people whose role you could have granted (protects owners from managers).
  assertCanGrant(actor, member.roleKey);
  return member;
}

export function listStaff(locationId: number): Promise<StaffMember[]> {
  return repo.listStaff(locationId);
}

export async function createStaff(actor: StaffActor, raw: unknown): Promise<StaffMember> {
  const input = staffCreateSchema.parse(raw);
  assertCanGrant(actor, input.roleKey);
  await assertEmailFree(input.email);

  const [passwordHash, pinHash] = await Promise.all([
    input.password ? hashSecret(input.password) : null,
    input.pin ? hashSecret(input.pin) : null,
  ]);

  const userId = await db.transaction(async (trx) => {
    const id = await repo.insertUser(
      {
        accountId: actor.accountId,
        name: input.name,
        email: input.email ?? null,
        phone: input.phone ?? null,
        lang: input.lang,
        passwordHash,
        pinHash,
      },
      trx,
    );
    await repo.setLocationRole(
      id,
      actor.locationId,
      await accessRepo.findRoleId(input.roleKey, trx),
      trx,
    );
    await writeAudit(
      actor,
      {
        action: 'staff.created',
        entityType: 'user',
        entityId: id,
        after: {
          name: input.name,
          email: input.email ?? null,
          roleKey: input.roleKey,
          hasPassword: Boolean(passwordHash),
          hasPin: Boolean(pinHash),
        },
      },
      trx,
    );
    return id;
  });

  return (await repo.findStaffMember(actor.locationId, userId))!;
}

export async function updateStaff(
  actor: StaffActor,
  userId: number,
  raw: unknown,
): Promise<StaffMember> {
  const input = staffUpdateSchema.parse(raw);
  const before = await loadManageable(actor, userId);

  const isSelf = userId === actor.userId;
  if (isSelf && input.roleKey !== undefined && input.roleKey !== before.roleKey) {
    throw AppError.conflict('CANNOT_CHANGE_SELF', 'You cannot change your own role.');
  }
  if (isSelf && input.active === false) {
    throw AppError.conflict('CANNOT_CHANGE_SELF', 'You cannot deactivate yourself.');
  }
  if (input.roleKey) assertCanGrant(actor, input.roleKey);
  if (input.email !== undefined) await assertEmailFree(input.email, userId);

  await db.transaction(async (trx) => {
    await repo.updateUser(
      userId,
      {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.email !== undefined ? { email: input.email } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        ...(input.lang !== undefined ? { lang: input.lang } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
      },
      trx,
    );

    if (input.roleKey && input.roleKey !== before.roleKey) {
      await repo.setLocationRole(
        userId,
        actor.locationId,
        await accessRepo.findRoleId(input.roleKey, trx),
        trx,
      );
      // Permission changes always get their own audit row (business rule 9).
      await writeAudit(
        actor,
        {
          action: 'staff.role_changed',
          entityType: 'user',
          entityId: userId,
          before: { roleKey: before.roleKey },
          after: { roleKey: input.roleKey },
        },
        trx,
      );
    }

    if (input.active === false && before.active) {
      await authRepo.revokeAllForUser(userId, 'deactivated', trx);
    }

    await writeAudit(
      actor,
      { action: 'staff.updated', entityType: 'user', entityId: userId, before, after: input },
      trx,
    );
  });

  return (await repo.findStaffMember(actor.locationId, userId))!;
}

/** Sets a password and/or PIN. A new PIN clears any lockout; a new password ends other sessions. */
export async function setCredentials(
  actor: StaffActor,
  userId: number,
  raw: unknown,
): Promise<StaffMember> {
  const input = staffCredentialsSchema.parse(raw);
  if (userId !== actor.userId) await loadManageable(actor, userId);
  else if (!(await repo.findStaffMember(actor.locationId, userId))) throw AppError.notFound();

  const patch: Record<string, unknown> = {};
  if (input.password) patch.password_hash = await hashSecret(input.password);
  if (input.pin) {
    patch.pin_hash = await hashSecret(input.pin);
    patch.pin_failed_attempts = 0;
    patch.pin_locked_until = null;
  }

  await db.transaction(async (trx) => {
    await repo.updateUser(userId, patch, trx);
    if (input.password && userId !== actor.userId) {
      await authRepo.revokeAllForUser(userId, 'password_reset', trx);
    }
    await writeAudit(
      actor,
      {
        action: 'staff.credentials_changed',
        entityType: 'user',
        entityId: userId,
        after: { password: Boolean(input.password), pin: Boolean(input.pin) },
      },
      trx,
    );
  });

  return (await repo.findStaffMember(actor.locationId, userId))!;
}
