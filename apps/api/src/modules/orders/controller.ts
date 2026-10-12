import type { Request, Response } from 'express';
import { z } from 'zod';
import { refSchema } from '@tavolina/shared';
import { actorFromRequest } from '../../lib/audit.js';
import { getLocation } from '../../middleware/auth.js';
import * as kds from './kds.js';
import * as service from './service.js';
import type { OrderActor } from './service.js';

const id = (req: Request) =>
  z.object({ id: z.coerce.number().int().positive() }).parse(req.params).id;
/** Orders, sessions and items can be addressed by id or by their client-generated uuid. */
const ref = (req: Request) => {
  const value = z.object({ ref: refSchema }).parse(req.params).ref;
  return typeof value === 'number' ? value : String(value);
};

function orderActor(req: Request): OrderActor {
  const location = getLocation(req);
  return { ...actorFromRequest(req), locationId: location.id, permissions: location.permissions };
}

export const listOrders = async (req: Request, res: Response) => {
  res.json(await service.listOpenOrders(orderActor(req)));
};
export const createOrder = async (req: Request, res: Response) => {
  res.status(201).json(await service.createOrder(orderActor(req), req.body));
};
export const getOrder = async (req: Request, res: Response) => {
  res.json(await service.getOrder(orderActor(req), ref(req)));
};
export const getSessionOrder = async (req: Request, res: Response) => {
  res.json({ order: await service.getSessionOrder(orderActor(req), ref(req)) });
};
export const addSessionItems = async (req: Request, res: Response) => {
  res.status(201).json(await service.addSessionItems(orderActor(req), ref(req), req.body));
};
export const addItems = async (req: Request, res: Response) => {
  res.status(201).json(await service.addItems(orderActor(req), ref(req), req.body));
};
export const sendItems = async (req: Request, res: Response) => {
  res.json(await service.sendItems(orderActor(req), ref(req), req.body));
};
export const fireCourse = async (req: Request, res: Response) => {
  res.json(await service.fireCourse(orderActor(req), ref(req), req.body));
};
export const serveItems = async (req: Request, res: Response) => {
  res.json(await service.serveItems(orderActor(req), ref(req), req.body));
};
export const repeatItems = async (req: Request, res: Response) => {
  res.status(201).json(await service.repeatItems(orderActor(req), ref(req), req.body));
};

export const updateItem = async (req: Request, res: Response) => {
  res.json(await service.updateDraftItem(orderActor(req), ref(req), req.body));
};
export const deleteItem = async (req: Request, res: Response) => {
  res.json(await service.deleteDraftItem(orderActor(req), ref(req)));
};
export const voidItem = async (req: Request, res: Response) => {
  res.json(await service.voidItem(orderActor(req), ref(req), req.body));
};
export const serveItem = async (req: Request, res: Response) => {
  const item = await service.orderOfItem(orderActor(req), ref(req));
  res.json(await service.serveItems(orderActor(req), item.orderId, { itemRefs: [item.itemId] }));
};
export const setItemStatus = async (req: Request, res: Response) => {
  await service.setItemStatus(orderActor(req), ref(req), req.body);
  res.status(204).end();
};

export const kdsBoard = async (req: Request, res: Response) => {
  res.json(await kds.getBoard(orderActor(req), id(req)));
};
export const bumpTicket = async (req: Request, res: Response) => {
  res.json(await kds.bumpTicket(orderActor(req), id(req)));
};
export const recallTicket = async (req: Request, res: Response) => {
  res.json(await kds.recallTicket(orderActor(req), id(req)));
};
export const listApprovers = async (req: Request, res: Response) => {
  res.json(await kds.listApprovers(orderActor(req)));
};
export const kdsStations = async (req: Request, res: Response) => {
  res.json(await kds.listStations(orderActor(req)));
};
export const confirmGuestItems = async (req: Request, res: Response) => {
  res.json(await service.confirmGuestItems(orderActor(req), ref(req), req.body));
};
export const rejectGuestItems = async (req: Request, res: Response) => {
  res.json(await service.rejectGuestItems(orderActor(req), ref(req), req.body));
};
