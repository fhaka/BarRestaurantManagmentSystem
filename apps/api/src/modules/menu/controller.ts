import type { Request, Response } from 'express';
import { z } from 'zod';
import { actorFromRequest } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import { getLocation } from '../../middleware/auth.js';
import { exportMenuCsv, importMenuCsv } from './csv.js';
import { buildGuestMenu } from './guest.js';
import * as service from './service.js';
import type { MenuActor } from './service.js';

const idParam = z.object({ id: z.coerce.number().int().positive() });
const id = (req: Request) => idParam.parse(req.params).id;

function menuActor(req: Request): MenuActor {
  const location = getLocation(req);
  return { ...actorFromRequest(req), locationId: location.id, permissions: location.permissions };
}

export const getMenu = async (req: Request, res: Response) => {
  res.json(await service.getAdminMenu(menuActor(req)));
};

// Stations & tax rates
export const createStation = async (req: Request, res: Response) => {
  res.status(201).json(await service.createStation(menuActor(req), req.body));
};
export const updateStation = async (req: Request, res: Response) => {
  res.json(await service.updateStation(menuActor(req), id(req), req.body));
};
export const createTaxRate = async (req: Request, res: Response) => {
  res.status(201).json(await service.createTaxRate(menuActor(req), req.body));
};
export const updateTaxRate = async (req: Request, res: Response) => {
  res.json(await service.updateTaxRate(menuActor(req), id(req), req.body));
};

// Categories
export const createCategory = async (req: Request, res: Response) => {
  res.status(201).json(await service.createCategory(menuActor(req), req.body));
};
export const updateCategory = async (req: Request, res: Response) => {
  res.json(await service.updateCategory(menuActor(req), id(req), req.body));
};
export const deleteCategory = async (req: Request, res: Response) => {
  await service.deleteCategory(menuActor(req), id(req));
  res.status(204).end();
};
export const reorderCategories = async (req: Request, res: Response) => {
  await service.reorderCategories(menuActor(req), req.body);
  res.status(204).end();
};
export const setCategoryImage = async (req: Request, res: Response) => {
  res.json(await service.setCategoryImage(menuActor(req), id(req), req.file?.buffer));
};

// Items
export const createItem = async (req: Request, res: Response) => {
  res.status(201).json(await service.createItem(menuActor(req), req.body));
};
export const updateItem = async (req: Request, res: Response) => {
  res.json(await service.updateItem(menuActor(req), id(req), req.body));
};
export const deleteItem = async (req: Request, res: Response) => {
  await service.deleteItem(menuActor(req), id(req));
  res.status(204).end();
};
export const reorderItems = async (req: Request, res: Response) => {
  await service.reorderItems(menuActor(req), id(req), req.body);
  res.status(204).end();
};
export const setOutOfStock = async (req: Request, res: Response) => {
  res.json(await service.setOutOfStock(menuActor(req), id(req), req.body));
};
export const setItemImage = async (req: Request, res: Response) => {
  res.json(await service.setItemImage(menuActor(req), id(req), req.file?.buffer));
};
export const removeItemImage = async (req: Request, res: Response) => {
  res.json(await service.removeItemImage(menuActor(req), id(req)));
};

// Modifier groups
export const createModifierGroup = async (req: Request, res: Response) => {
  res.status(201).json(await service.createModifierGroup(menuActor(req), req.body));
};
export const updateModifierGroup = async (req: Request, res: Response) => {
  res.json(await service.updateModifierGroup(menuActor(req), id(req), req.body));
};
export const deleteModifierGroup = async (req: Request, res: Response) => {
  await service.deleteModifierGroup(menuActor(req), id(req));
  res.status(204).end();
};

// Price rules
export const createPriceRule = async (req: Request, res: Response) => {
  res.status(201).json(await service.createPriceRule(menuActor(req), req.body));
};
export const updatePriceRule = async (req: Request, res: Response) => {
  res.json(await service.updatePriceRule(menuActor(req), id(req), req.body));
};
export const deletePriceRule = async (req: Request, res: Response) => {
  await service.deletePriceRule(menuActor(req), id(req));
  res.status(204).end();
};

// CSV
export const exportCsv = async (req: Request, res: Response) => {
  const location = getLocation(req);
  const date = new Date().toISOString().slice(0, 10);
  res
    .type('text/csv; charset=utf-8')
    .attachment(`menu-${location.id}-${date}.csv`)
    .send(await exportMenuCsv(location.id));
};
export const importCsv = async (req: Request, res: Response) => {
  const result = await importMenuCsv(menuActor(req), req.body);
  if (result.errors.length) {
    // Same envelope as every other error; the row list is in details.errors.
    throw new AppError(422, 'IMPORT_INVALID', 'Some rows have problems. Nothing was changed.', {
      ...result,
    });
  }
  res.json(result);
};

// Preview of the guest menu for staff (same data as the public endpoint)
export const guestPreview = async (req: Request, res: Response) => {
  const { lang } = z.object({ lang: z.string().max(5).optional() }).parse(req.query);
  res.json(await buildGuestMenu(getLocation(req).id, { lang }));
};

// Combos
export const createCombo = async (req: Request, res: Response) => {
  res.status(201).json(await service.createCombo(menuActor(req), req.body));
};
export const updateCombo = async (req: Request, res: Response) => {
  res.json(await service.updateCombo(menuActor(req), id(req), req.body));
};
export const deleteCombo = async (req: Request, res: Response) => {
  await service.deleteCombo(menuActor(req), id(req));
  res.status(204).end();
};
