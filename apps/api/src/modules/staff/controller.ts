import type { Request, Response } from 'express';
import { z } from 'zod';
import { actorFromRequest } from '../../lib/audit.js';
import { getLocation } from '../../middleware/auth.js';
import * as service from './service.js';
import type { StaffActor } from './service.js';

const idParam = z.object({ id: z.coerce.number().int().positive() });

function staffActor(req: Request): StaffActor {
  const location = getLocation(req);
  return {
    ...actorFromRequest(req),
    locationId: location.id,
    permissions: location.permissions,
  };
}

export async function list(req: Request, res: Response) {
  res.json(await service.listStaff(getLocation(req).id));
}

export async function create(req: Request, res: Response) {
  res.status(201).json(await service.createStaff(staffActor(req), req.body));
}

export async function update(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  res.json(await service.updateStaff(staffActor(req), id, req.body));
}

export async function setCredentials(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  res.json(await service.setCredentials(staffActor(req), id, req.body));
}
