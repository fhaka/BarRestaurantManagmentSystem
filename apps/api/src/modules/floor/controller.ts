import type { Request, Response } from 'express';
import { z } from 'zod';
import { actorFromRequest } from '../../lib/audit.js';
import { getLocation } from '../../middleware/auth.js';
import * as service from './service.js';
import * as sessions from './sessions.js';
import type { FloorActor } from './service.js';

const id = (req: Request) =>
  z.object({ id: z.coerce.number().int().positive() }).parse(req.params).id;

function floorActor(req: Request): FloorActor {
  const location = getLocation(req);
  return { ...actorFromRequest(req), locationId: location.id, permissions: location.permissions };
}

export const getFloor = async (req: Request, res: Response) => {
  res.json(await service.getFloor(floorActor(req)));
};

// Areas
export const createArea = async (req: Request, res: Response) => {
  res.status(201).json(await service.createArea(floorActor(req), req.body));
};
export const updateArea = async (req: Request, res: Response) => {
  res.json(await service.updateArea(floorActor(req), id(req), req.body));
};
export const deleteArea = async (req: Request, res: Response) => {
  await service.deleteArea(floorActor(req), id(req));
  res.status(204).end();
};
export const areaQrSheet = async (req: Request, res: Response) => {
  res.json(await service.getAreaQrSheet(floorActor(req), id(req)));
};

// Tables
export const createTable = async (req: Request, res: Response) => {
  res.status(201).json(await service.createTable(floorActor(req), req.body));
};
export const updateTable = async (req: Request, res: Response) => {
  res.json(await service.updateTable(floorActor(req), id(req), req.body));
};
export const deleteTable = async (req: Request, res: Response) => {
  await service.deleteTable(floorActor(req), id(req));
  res.status(204).end();
};
export const saveLayout = async (req: Request, res: Response) => {
  res.json(await service.saveLayout(floorActor(req), req.body));
};
export const tableQr = async (req: Request, res: Response) => {
  const qr = await service.getTableQr(floorActor(req), id(req));
  if (req.accepts(['json', 'image/svg+xml']) === 'image/svg+xml') {
    res.type('image/svg+xml').send(qr.svg);
  } else {
    res.json(qr);
  }
};
export const rotateQr = async (req: Request, res: Response) => {
  res.json(await service.rotateQr(floorActor(req), id(req)));
};
export const markClean = async (req: Request, res: Response) => {
  res.json(await sessions.markClean(floorActor(req), id(req)));
};

// Table sessions
export const openSession = async (req: Request, res: Response) => {
  res.status(201).json(await sessions.openSession(floorActor(req), req.body));
};
export const updateSession = async (req: Request, res: Response) => {
  res.json(await sessions.updateSession(floorActor(req), id(req), req.body));
};
export const transferSession = async (req: Request, res: Response) => {
  res.json(await sessions.transferSession(floorActor(req), id(req), req.body));
};
export const mergeSession = async (req: Request, res: Response) => {
  res.json(await sessions.mergeSession(floorActor(req), id(req), req.body));
};
export const splitSession = async (req: Request, res: Response) => {
  res.json(await sessions.splitSession(floorActor(req), id(req), req.body));
};
export const requestBill = async (req: Request, res: Response) => {
  res.json(await sessions.requestBill(floorActor(req), id(req)));
};
export const reopenSession = async (req: Request, res: Response) => {
  res.json(await sessions.reopenSession(floorActor(req), id(req)));
};
export const closeSession = async (req: Request, res: Response) => {
  res.json(await sessions.closeSession(floorActor(req), id(req)));
};
