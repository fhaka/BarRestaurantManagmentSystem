import type { Request, Response } from 'express';
import { z } from 'zod';
import { actorFromRequest } from '../../lib/audit.js';
import { getAuth, getLocation } from '../../middleware/auth.js';
import * as service from './service.js';

const idParam = z.object({ id: z.coerce.number().int().positive() });

export async function list(req: Request, res: Response) {
  res.json(await service.listForUser(getAuth(req).userId));
}

/** The current location (X-Location-Id) with its settings. */
export async function current(req: Request, res: Response) {
  res.json(await service.getLocation(getLocation(req).id));
}

export async function create(req: Request, res: Response) {
  res.status(201).json(await service.createLocation(actorFromRequest(req), req.body));
}

export async function update(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  res.json(await service.updateLocation(actorFromRequest(req), id, req.body));
}
