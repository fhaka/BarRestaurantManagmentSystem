import { Router, type Request } from 'express';
import { actorFromRequest } from '../../lib/audit.js';
import { getLocation } from '../../middleware/auth.js';
import { scoped } from '../../middleware/stacks.js';
import * as service from './service.js';

/** Read-only by design (plan §5.14): there is no route that edits or deletes audit rows. */
export const auditRouter = Router();

const view = scoped('audit.view');
function actor(req: Request): service.AuditActor {
  const location = getLocation(req);
  return { ...actorFromRequest(req), locationId: location.id, permissions: location.permissions };
}

auditRouter.get('/audit-logs', ...view, async (req, res) => {
  res.json(await service.listAuditLogs(actor(req), req.query));
});
auditRouter.get('/audit-logs/facets', ...view, async (req, res) => {
  res.json(await service.auditFacets(actor(req)));
});
