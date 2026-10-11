import { Router, type Request, type Response } from 'express';
import { authLimiter } from '../../middleware/rate-limit.js';
import { getLocation } from '../../middleware/auth.js';
import { scoped } from '../../middleware/stacks.js';
import { actorFromRequest } from '../../lib/audit.js';
import { createApproval } from './service.js';

export const approvalsRouter = Router();

// Any signed-in staff member can ask; the approver's own permission and PIN decide.
approvalsRouter.post(
  '/approvals',
  authLimiter,
  ...scoped(),
  async (req: Request, res: Response) => {
    const location = getLocation(req);
    const result = await createApproval(
      { ...actorFromRequest(req), locationId: location.id },
      req.body,
    );
    res.status(201).json(result);
  },
);
