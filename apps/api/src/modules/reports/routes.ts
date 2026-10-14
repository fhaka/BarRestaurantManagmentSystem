import { Router, type Request } from 'express';
import { actorFromRequest } from '../../lib/audit.js';
import { getLocation } from '../../middleware/auth.js';
import { scoped } from '../../middleware/stacks.js';
import * as service from './service.js';

export const reportsRouter = Router();

const view = scoped('report.view');
function actor(req: Request): service.ReportActor {
  const location = getLocation(req);
  return { ...actorFromRequest(req), locationId: location.id, permissions: location.permissions };
}

// Plan §9: GET /reports/sales | /items | /staff | /payments | /discounts-voids | /inventory | /hours
reportsRouter.get('/reports/dashboard', ...view, async (req, res) => {
  res.json(await service.dashboard(actor(req)));
});
reportsRouter.get('/reports/sales', ...view, async (req, res) => {
  res.json(await service.sales(actor(req), req.query));
});
reportsRouter.get('/reports/items', ...view, async (req, res) => {
  res.json(await service.items(actor(req), req.query));
});
reportsRouter.get('/reports/staff', ...view, async (req, res) => {
  res.json(await service.staff(actor(req), req.query));
});
reportsRouter.get('/reports/payments', ...view, async (req, res) => {
  res.json(await service.payments(actor(req), req.query));
});
reportsRouter.get('/reports/discounts-voids', ...view, async (req, res) => {
  res.json(await service.discountsVoids(actor(req), req.query));
});
reportsRouter.get('/reports/inventory', ...view, async (req, res) => {
  res.json(await service.inventory(actor(req), req.query));
});
reportsRouter.get('/reports/hours', ...view, async (req, res) => {
  res.json(await service.hoursReport(actor(req), req.query));
});
