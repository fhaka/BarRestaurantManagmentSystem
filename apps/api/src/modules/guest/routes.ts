import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { isProduction } from '../../config/env.js';
import { actorFromRequest } from '../../lib/audit.js';
import { getLocation } from '../../middleware/auth.js';
import { guestLimiter } from '../../middleware/rate-limit.js';
import { scoped } from '../../middleware/stacks.js';
import { buildGuestMenu } from '../menu/guest.js';
import * as guest from './service.js';
import * as staff from './staff.js';

/** Public guest endpoints (no account): the QR menu at /t/:tableToken and the public menu. */
export const guestRouter = Router();

const GUEST_COOKIE = 'tav_gs';
const cookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: isProduction,
  path: '/api/v1/guest',
  maxAge: 12 * 60 * 60 * 1000,
};

const params = z.object({ locationId: z.coerce.number().int().positive() });
const tokenParams = z.object({ tableToken: z.string().min(10).max(64) });
const query = z.object({ lang: z.string().max(5).optional() });

const acceptLanguage = (req: Request) => req.get('accept-language') ?? undefined;
const cookieToken = (req: Request): string | undefined =>
  (req.cookies as Record<string, string> | undefined)?.[GUEST_COOKIE];

guestRouter.get('/guest/locations/:locationId/menu', guestLimiter, async (req, res) => {
  const { locationId } = params.parse(req.params);
  const { lang } = query.parse(req.query);
  const menu = await buildGuestMenu(locationId, { lang, acceptLanguage: acceptLanguage(req) });
  // Prices can change with happy hour, so caches must revalidate soon.
  res.set('Cache-Control', 'public, max-age=30').json(menu);
});

async function tableFor(req: Request) {
  return guest.resolveTable(tokenParams.parse(req.params).tableToken);
}

/** Gets (or starts) this phone's guest session; a new one gets a fresh cookie. */
async function guestFor(req: Request, res: Response, table: guest.GuestTable) {
  const { session, newToken } = await guest.ensureGuestSession(
    table,
    cookieToken(req),
    query.parse(req.query).lang,
  );
  if (newToken) res.cookie(GUEST_COOKIE, newToken, cookieOptions);
  return session;
}

guestRouter.get('/guest/t/:tableToken', guestLimiter, async (req, res) => {
  res.set('Cache-Control', 'no-store').json(guest.tableInfo(await tableFor(req)));
});

guestRouter.get('/guest/t/:tableToken/menu', guestLimiter, async (req, res) => {
  const table = await tableFor(req);
  const { lang } = query.parse(req.query);
  const menu = await buildGuestMenu(table.location.id, {
    lang,
    acceptLanguage: acceptLanguage(req),
  });
  res.set('Cache-Control', 'no-store').json(menu);
});

// Loading the state also starts the phone's visit (sets the cookie), so the phone knows its own
// lines even when a live update makes it refetch while its first order is still on the way.
guestRouter.get('/guest/t/:tableToken/state', guestLimiter, async (req, res) => {
  const table = await tableFor(req);
  const session = await guestFor(req, res, table);
  res.set('Cache-Control', 'no-store').json(await guest.tableState(table, session));
});

guestRouter.post('/guest/t/:tableToken/orders', guestLimiter, async (req, res) => {
  const table = await tableFor(req);
  const session = await guestFor(req, res, table);
  await guest.placeOrder(table, session, req.body);
  res.status(201).json(await guest.tableState(table, session));
});

guestRouter.post('/guest/t/:tableToken/requests', guestLimiter, async (req, res) => {
  const table = await tableFor(req);
  const session = await guestFor(req, res, table);
  await guest.createRequest(table, session, req.body);
  res.status(201).json(await guest.tableState(table, session));
});

// ---- Staff side ------------------------------------------------------------------------------

const idParams = z.object({ id: z.coerce.number().int().positive() });
const refParams = z.object({ ref: z.union([z.uuid(), z.coerce.number().int().positive()]) });

function staffActor(req: Request): staff.StaffActor {
  const location = getLocation(req);
  return { ...actorFromRequest(req), locationId: location.id, permissions: location.permissions };
}

guestRouter.get('/service-requests', ...scoped('floor.view'), async (req, res) => {
  res.json(await staff.listRequests(staffActor(req)));
});
guestRouter.post('/service-requests/:id/handle', ...scoped('floor.view'), async (req, res) => {
  await staff.handleRequest(staffActor(req), idParams.parse(req.params).id);
  res.status(204).end();
});
guestRouter.get('/table-sessions/:ref/guests', ...scoped('order.create'), async (req, res) => {
  res.json(await staff.listGuestSessions(staffActor(req), refParams.parse(req.params).ref));
});
guestRouter.post('/guest-sessions/:id/block', ...scoped('table.open'), async (req, res) => {
  await staff.blockGuestSession(staffActor(req), idParams.parse(req.params).id, req.body);
  res.status(204).end();
});
