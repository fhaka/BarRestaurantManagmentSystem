import type { Request, RequestHandler } from 'express';
import type { Permission } from '@tavolina/shared';
import { AppError } from '../lib/errors.js';
import { verifyAccessToken } from '../lib/jwt.js';
import * as accessRepo from '../modules/auth/access-repo.js';

/** Verifies the Bearer access token and that the user is still active. */
export const requireAuth: RequestHandler = async (req, _res, next) => {
  const header = req.get('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : undefined;
  if (!token) throw AppError.unauthenticated();

  const result = await verifyAccessToken(token);
  if (!result.ok) {
    throw result.expired
      ? new AppError(401, 'SESSION_EXPIRED', 'Your session expired. Refresh and try again.')
      : AppError.unauthenticated();
  }

  const user = await accessRepo.findActiveUser(result.claims.userId);
  if (!user || user.accountId !== result.claims.accountId) throw AppError.unauthenticated();

  req.auth = { ...result.claims, name: user.name };
  next();
};

/** Resolves X-Location-Id to a location the user can access, with their role and permissions. */
export const requireLocation: RequestHandler = async (req, _res, next) => {
  const auth = getAuth(req);
  const raw = req.get('x-location-id');
  const locationId = raw && /^\d{1,18}$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(locationId) || locationId <= 0) {
    throw new AppError(400, 'LOCATION_REQUIRED', 'Choose a location (X-Location-Id header).');
  }

  const access = await accessRepo.findLocationAccess(auth.userId, locationId);
  if (!access || access.accountId !== auth.accountId) {
    throw new AppError(403, 'LOCATION_FORBIDDEN', 'You do not have access to this location.');
  }

  req.location = {
    id: locationId,
    accountId: access.accountId,
    name: access.locationName,
    roleKey: access.roleKey,
    permissions: await accessRepo.getRolePermissions(access.roleId),
  };
  next();
};

/** Requires every listed permission at the current location. Use after requireLocation. */
export function requirePermission(...required: Permission[]): RequestHandler {
  return (req, _res, next) => {
    const location = getLocation(req);
    const missing = required.filter((p) => !location.permissions.has(p));
    if (missing.length) {
      throw new AppError(403, 'FORBIDDEN', 'You do not have permission to do this.', {
        missing,
      });
    }
    next();
  };
}

export function getAuth(req: Request): NonNullable<Request['auth']> {
  if (!req.auth) throw AppError.unauthenticated();
  return req.auth;
}

export function getLocation(req: Request): NonNullable<Request['location']> {
  if (!req.location) {
    throw new AppError(400, 'LOCATION_REQUIRED', 'Choose a location (X-Location-Id header).');
  }
  return req.location;
}
