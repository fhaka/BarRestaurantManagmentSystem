import { Router, type Request } from 'express';
import { z } from 'zod';
import { STOCK_MOVEMENT_TYPES } from '@tavolina/shared';
import { actorFromRequest } from '../../lib/audit.js';
import { getLocation } from '../../middleware/auth.js';
import { scoped } from '../../middleware/stacks.js';
import * as inv from './service.js';

export const inventoryRouter = Router();

const view = scoped('inventory.view');
const manage = scoped('inventory.manage');
const id = (req: Request) =>
  z.object({ id: z.coerce.number().int().positive() }).parse(req.params).id;
function actor(req: Request): inv.InventoryActor {
  const location = getLocation(req);
  return { ...actorFromRequest(req), locationId: location.id, permissions: location.permissions };
}

// Suppliers
inventoryRouter.get('/suppliers', ...view, async (req, res) => {
  res.json(await inv.listSuppliers(actor(req)));
});
inventoryRouter.post('/suppliers', ...manage, async (req, res) => {
  res.status(201).json(await inv.saveSupplier(actor(req), null, req.body));
});
inventoryRouter.patch('/suppliers/:id', ...manage, async (req, res) => {
  res.json(await inv.saveSupplier(actor(req), id(req), req.body));
});
inventoryRouter.delete('/suppliers/:id', ...manage, async (req, res) => {
  await inv.deleteSupplier(actor(req), id(req));
  res.status(204).end();
});

// Ingredients and stock
inventoryRouter.get('/ingredients', ...view, async (req, res) => {
  res.json(await inv.listIngredients(actor(req)));
});
inventoryRouter.get('/ingredients/low', ...view, async (req, res) => {
  res.json(await inv.lowStock(actor(req)));
});
inventoryRouter.post('/ingredients', ...manage, async (req, res) => {
  res.status(201).json(await inv.createIngredient(actor(req), req.body));
});
inventoryRouter.patch('/ingredients/:id', ...manage, async (req, res) => {
  res.json(await inv.updateIngredient(actor(req), id(req), req.body));
});
inventoryRouter.delete('/ingredients/:id', ...manage, async (req, res) => {
  await inv.deleteIngredient(actor(req), id(req));
  res.status(204).end();
});
inventoryRouter.get('/stock-movements', ...view, async (req, res) => {
  const filter = z
    .object({
      ingredientId: z.coerce.number().int().positive().optional(),
      type: z.enum(STOCK_MOVEMENT_TYPES).optional(),
      limit: z.coerce.number().int().min(1).max(1000).optional(),
    })
    .parse(req.query);
  res.json(await inv.listMovements(actor(req), filter));
});
inventoryRouter.post('/waste', ...manage, async (req, res) => {
  await inv.recordWaste(actor(req), req.body);
  res.status(204).end();
});

// Recipes, food cost and margins
inventoryRouter.get('/costing', ...view, async (req, res) => {
  res.json(await inv.costing(actor(req)));
});
inventoryRouter.put('/menu/items/:id/recipe', ...manage, async (req, res) => {
  res.json(await inv.saveRecipe(actor(req), 'item', id(req), req.body));
});
inventoryRouter.put('/menu/modifiers/:id/recipe', ...manage, async (req, res) => {
  res.json(await inv.saveRecipe(actor(req), 'modifier', id(req), req.body));
});

// Purchase orders
inventoryRouter.get('/purchase-orders', ...view, async (req, res) => {
  res.json(await inv.listPurchaseOrders(actor(req)));
});
inventoryRouter.get('/purchase-orders/:id', ...view, async (req, res) => {
  res.json(await inv.getPurchaseOrder(actor(req), id(req)));
});
inventoryRouter.post('/purchase-orders', ...manage, async (req, res) => {
  res.status(201).json(await inv.createPurchaseOrder(actor(req), req.body));
});
inventoryRouter.patch('/purchase-orders/:id', ...manage, async (req, res) => {
  res.json(await inv.updatePurchaseOrder(actor(req), id(req), req.body));
});
inventoryRouter.post('/purchase-orders/:id/send', ...manage, async (req, res) => {
  res.json(await inv.setPurchaseOrderStatus(actor(req), id(req), 'sent'));
});
inventoryRouter.post('/purchase-orders/:id/cancel', ...manage, async (req, res) => {
  res.json(await inv.setPurchaseOrderStatus(actor(req), id(req), 'cancelled'));
});
inventoryRouter.post('/purchase-orders/:id/receive', ...manage, async (req, res) => {
  res.json(await inv.receivePurchaseOrder(actor(req), id(req), req.body));
});

// Stock counts
inventoryRouter.get('/stock-counts', ...view, async (req, res) => {
  res.json(await inv.listCounts(actor(req)));
});
inventoryRouter.get('/stock-counts/:id', ...view, async (req, res) => {
  res.json(await inv.getCount(actor(req), id(req)));
});
inventoryRouter.post('/stock-counts', ...manage, async (req, res) => {
  res.status(201).json(await inv.createCount(actor(req), req.body));
});
inventoryRouter.patch('/stock-counts/:id', ...manage, async (req, res) => {
  res.json(await inv.saveCountLines(actor(req), id(req), req.body));
});
inventoryRouter.post('/stock-counts/:id/apply', ...manage, async (req, res) => {
  res.json(await inv.applyCount(actor(req), id(req)));
});
inventoryRouter.post('/stock-counts/:id/cancel', ...manage, async (req, res) => {
  res.json(await inv.cancelCount(actor(req), id(req)));
});
