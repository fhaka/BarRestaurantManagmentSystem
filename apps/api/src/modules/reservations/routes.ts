import { Router, type Request } from 'express';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { actorFromRequest } from '../../lib/audit.js';
import { getLocation } from '../../middleware/auth.js';
import { bookingLimiter, guestLimiter } from '../../middleware/rate-limit.js';
import { scoped } from '../../middleware/stacks.js';
import * as service from './service.js';

export const reservationsRouter = Router();

const view = scoped('reservation.view');
const manage = scoped('reservation.manage');
const id = (req: Request) =>
  z.object({ id: z.coerce.number().int().positive() }).parse(req.params).id;
const locationParam = (req: Request) =>
  z.object({ locationId: z.coerce.number().int().positive() }).parse(req.params).locationId;
function actor(req: Request): service.ReservationActor {
  const location = getLocation(req);
  return { ...actorFromRequest(req), locationId: location.id, permissions: location.permissions };
}

reservationsRouter.get('/reservations', ...view, async (req, res) => {
  const { date } = z.object({ date: z.iso.date() }).parse(req.query);
  res.json(await service.listReservations(actor(req), date));
});
reservationsRouter.get('/reservations/availability', ...view, async (req, res) => {
  res.json(await service.availability(actor(req), req.query));
});
/** The public booking page of this location, to link from a website or social media. */
reservationsRouter.get('/reservations/booking-link', ...view, (req, res) => {
  res.json({ url: `${env.GUEST_APP_URL.replace(/\/$/, '')}/book/${getLocation(req).id}` });
});
reservationsRouter.get('/reservations/:id', ...view, async (req, res) => {
  res.json(await service.getReservation(actor(req), id(req)));
});
reservationsRouter.post('/reservations', ...manage, async (req, res) => {
  res.status(201).json(await service.createReservation(actor(req), req.body));
});
reservationsRouter.patch('/reservations/:id', ...manage, async (req, res) => {
  res.json(await service.updateReservation(actor(req), id(req), req.body));
});
reservationsRouter.post('/reservations/:id/status', ...manage, async (req, res) => {
  res.json(await service.setStatus(actor(req), id(req), req.body));
});

// Public booking page (plan §5.10), no account.
reservationsRouter.get('/public/locations/:locationId/booking', guestLimiter, async (req, res) => {
  res.set('Cache-Control', 'no-store').json(await service.publicInfo(locationParam(req)));
});
reservationsRouter.get(
  '/public/locations/:locationId/availability',
  guestLimiter,
  async (req, res) => {
    res
      .set('Cache-Control', 'no-store')
      .json(await service.publicAvailability(locationParam(req), req.query));
  },
);
reservationsRouter.post(
  '/public/locations/:locationId/reservations',
  bookingLimiter,
  async (req, res) => {
    res.status(201).json(await service.publicBook(locationParam(req), req.body));
  },
);
