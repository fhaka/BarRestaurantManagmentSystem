import { Router, type Request } from 'express';
import { z } from 'zod';
import { actorFromRequest } from '../../lib/audit.js';
import { getLocation } from '../../middleware/auth.js';
import { scoped } from '../../middleware/stacks.js';
import * as service from './service.js';

export const timeRouter = Router();

const self = scoped('time.clock');
const manage = scoped('shift.manage');
const id = (req: Request) =>
  z.object({ id: z.coerce.number().int().positive() }).parse(req.params).id;
function actor(req: Request): service.TimeActor {
  const location = getLocation(req);
  return { ...actorFromRequest(req), locationId: location.id, permissions: location.permissions };
}

// The signed-in person (plan §5.8).
timeRouter.get('/me/clock', ...self, async (req, res) => {
  res.json(await service.myStatus(actor(req)));
});
timeRouter.get('/me/shifts', ...self, async (req, res) => {
  res.json(await service.listShifts(actor(req), req.query, true));
});
timeRouter.post('/time-entries/clock-in', ...self, async (req, res) => {
  res.status(201).json(await service.clockSelf(actor(req), 'in'));
});
timeRouter.post('/time-entries/clock-out', ...self, async (req, res) => {
  res.json(await service.clockSelf(actor(req), 'out'));
});

// Schedule.
timeRouter.get('/shifts', ...manage, async (req, res) => {
  res.json(await service.listShifts(actor(req), req.query));
});
timeRouter.post('/shifts', ...manage, async (req, res) => {
  res.status(201).json(await service.saveShift(actor(req), null, req.body));
});
timeRouter.patch('/shifts/:id', ...manage, async (req, res) => {
  res.json(await service.saveShift(actor(req), id(req), req.body));
});
timeRouter.delete('/shifts/:id', ...manage, async (req, res) => {
  await service.deleteShift(actor(req), id(req));
  res.status(204).end();
});

// Clock entries and the hours report.
timeRouter.get('/time-entries', ...manage, async (req, res) => {
  res.json(await service.listEntries(actor(req), req.query));
});
timeRouter.get('/time-entries/hours', ...manage, async (req, res) => {
  res.json(await service.hours(actor(req), req.query));
});
timeRouter.get('/time-entries/hours.csv', ...manage, async (req, res) => {
  const { from, to } = z.object({ from: z.string(), to: z.string() }).parse(req.query);
  res
    .type('text/csv; charset=utf-8')
    .attachment(`ore-${from}-${to}.csv`)
    .send(await service.hoursCsv(actor(req), req.query));
});
timeRouter.post('/time-entries', ...manage, async (req, res) => {
  res.status(201).json(await service.saveEntry(actor(req), null, req.body));
});
timeRouter.patch('/time-entries/:id', ...manage, async (req, res) => {
  res.json(await service.saveEntry(actor(req), id(req), req.body));
});
timeRouter.delete('/time-entries/:id', ...manage, async (req, res) => {
  await service.deleteEntry(actor(req), id(req));
  res.status(204).end();
});
