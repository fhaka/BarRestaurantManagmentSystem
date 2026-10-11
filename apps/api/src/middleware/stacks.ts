import type { RequestHandler } from 'express';
import type { Permission } from '@tavolina/shared';
import { idempotency } from './idempotency.js';
import { requireAuth, requireLocation, requirePermission } from './auth.js';

/**
 * Middleware stacks attached per route (not router-wide), so unknown paths still 404.
 *   authed   — valid access token; Idempotency-Key honoured
 *   scoped() — authed + X-Location-Id + the listed permissions
 */
export const authed: RequestHandler[] = [requireAuth, idempotency];

export function scoped(...permissions: Permission[]): RequestHandler[] {
  return [
    requireAuth,
    requireLocation,
    ...(permissions.length ? [requirePermission(...permissions)] : []),
    idempotency,
  ];
}

/** Like requireLocation, but only when the X-Location-Id header is present. */
export const optionalLocation: RequestHandler = (req, res, next) =>
  req.get('x-location-id') ? requireLocation(req, res, next) : next();
