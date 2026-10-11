import {
  DEFAULT_LOCATION_SETTINGS,
  locationCreateSchema,
  locationSettingsSchema,
  locationUpdateSchema,
  type Location,
  type LocationAccess,
} from '@tavolina/shared';
import { db } from '../../db/knex.js';
import { AppError } from '../../lib/errors.js';
import { writeAudit, type ActorContext } from '../../lib/audit.js';
import * as accessRepo from '../auth/access-repo.js';
import * as repo from './repo.js';

export function listForUser(userId: number): Promise<LocationAccess[]> {
  return accessRepo.listLocationsForUser(userId);
}

export async function getLocation(id: number): Promise<Location> {
  const location = await repo.findLocation(id);
  if (!location) throw AppError.notFound('Location not found');
  return location;
}

/** Creates a location in the actor's account. Every owner of the account gets access to it. */
export async function createLocation(actor: ActorContext, raw: unknown): Promise<Location> {
  const input = locationCreateSchema.parse(raw);
  const settings = locationSettingsSchema.parse({
    ...DEFAULT_LOCATION_SETTINGS,
    ...input.settings,
  });

  const id = await db.transaction(async (trx) => {
    const locationId = await repo.insertLocation(
      {
        accountId: actor.accountId,
        name: input.name,
        address: input.address,
        nipt: input.nipt ?? null,
        settings,
      },
      trx,
    );
    const ownerRoleId = await accessRepo.findRoleId('owner', trx);
    const owners = await repo.listAccountOwnerIds(actor.accountId, trx);
    await repo.grantAccess([...new Set([...owners, actor.userId])], locationId, ownerRoleId, trx);
    await writeAudit(
      actor,
      {
        action: 'location.created',
        entityType: 'location',
        entityId: locationId,
        after: { name: input.name, address: input.address, nipt: input.nipt ?? null },
        locationId,
      },
      trx,
    );
    return locationId;
  });

  return getLocation(id);
}

/** Updates the current location. `settings` is merged key by key. */
export async function updateLocation(
  actor: ActorContext,
  locationId: number,
  raw: unknown,
): Promise<Location> {
  if (actor.locationId !== locationId) {
    throw new AppError(403, 'LOCATION_FORBIDDEN', 'Switch to this location to edit it.');
  }
  const input = locationUpdateSchema.parse(raw);
  const before = await getLocation(locationId);
  const settings = input.settings
    ? locationSettingsSchema.parse({ ...before.settings, ...input.settings })
    : undefined;

  await db.transaction(async (trx) => {
    await repo.updateLocation(
      locationId,
      {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.address !== undefined ? { address: input.address } : {}),
        ...(input.nipt !== undefined ? { nipt: input.nipt } : {}),
        ...(settings ? { settings } : {}),
      },
      trx,
    );
    await writeAudit(
      actor,
      {
        action: 'location.updated',
        entityType: 'location',
        entityId: locationId,
        before,
        after: input,
      },
      trx,
    );
  });

  return getLocation(locationId);
}
