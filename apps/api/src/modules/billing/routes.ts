import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { refSchema } from '@tavolina/shared';
import { actorFromRequest } from '../../lib/audit.js';
import { getLocation } from '../../middleware/auth.js';
import { scoped } from '../../middleware/stacks.js';
import type { OrderActor } from '../orders/service.js';
import * as printing from '../printing/admin.js';
import { retryDue } from '../fiscal/service.js';
import * as cash from './cash.js';
import * as day from './day.js';
import * as billing from './service.js';

export const billingRouter = Router();

const id = (req: Request) =>
  z.object({ id: z.coerce.number().int().positive() }).parse(req.params).id;
const ref = (req: Request) => {
  const value = z.object({ ref: refSchema }).parse(req.params).ref;
  return typeof value === 'number' ? value : String(value);
};
function actor(req: Request): OrderActor {
  const location = getLocation(req);
  return { ...actorFromRequest(req), locationId: location.id, permissions: location.permissions };
}
const billIdSchema = z.object({ billId: z.number().int().positive().nullish() });

// Bills, discounts, splits, payments, refunds (plan §5.7)
billingRouter.get('/orders/:ref/bill', ...scoped('payment.take'), async (req, res) => {
  res.json(await billing.getBill(actor(req), ref(req)));
});
billingRouter.post('/orders/:ref/discounts', ...scoped('order.discount'), async (req, res) => {
  res.status(201).json(await billing.addDiscount(actor(req), ref(req), req.body));
});
billingRouter.delete('/discounts/:id', ...scoped('order.discount'), async (req, res) => {
  res.json(await billing.removeDiscount(actor(req), id(req)));
});
billingRouter.post('/orders/:ref/split', ...scoped('bill.split'), async (req, res) => {
  res.json(await billing.splitBill(actor(req), ref(req), req.body));
});
billingRouter.post('/orders/:ref/payments', ...scoped('payment.take'), async (req, res) => {
  const { billId } = billIdSchema.parse(req.body ?? {});
  res.status(201).json(await billing.pay(actor(req), ref(req), billId ?? null, req.body));
});
billingRouter.post('/bills/:id/print', ...scoped('payment.take'), async (req, res) => {
  res.json(await billing.reprintReceipt(actor(req), id(req)));
});
billingRouter.post('/payments/:id/refund', ...scoped('payment.take'), async (req, res) => {
  res.status(201).json(await billing.refund(actor(req), id(req), req.body));
});

// Cash drawer (plan §5.8)
billingRouter.get('/cash-drawers/current', ...scoped('cash.drawer'), async (req, res) => {
  res.json({ drawer: await cash.currentDrawer(actor(req)) });
});
billingRouter.post('/cash-drawers', ...scoped('cash.drawer'), async (req, res) => {
  res.status(201).json(await cash.openDrawer(actor(req), req.body));
});
billingRouter.get('/cash-drawers/:id', ...scoped('cash.drawer'), async (req, res) => {
  res.json(await cash.getDrawer(actor(req), id(req)));
});
billingRouter.post('/cash-drawers/:id/movements', ...scoped('cash.movement'), async (req, res) => {
  res.status(201).json(await cash.addMovement(actor(req), id(req), req.body));
});
billingRouter.post('/cash-drawers/:id/no-sale', ...scoped('cash.drawer'), async (req, res) => {
  res.json(await cash.noSale(actor(req), id(req), req.body));
});
billingRouter.post('/cash-drawers/:id/close', ...scoped('cash.drawer'), async (req, res) => {
  res.json(await cash.closeDrawer(actor(req), id(req), req.body));
});

// End of day: X report while open, Z report when closing (plan §5.8)
billingRouter.get('/business-days/current/report', ...scoped('cash.drawer'), async (req, res) => {
  res.json(await day.currentReport(actor(req)));
});
billingRouter.get('/business-days/:date/report', ...scoped('cash.drawer'), async (req, res) => {
  res.json(await day.reportFor(actor(req), String(req.params.date)));
});
billingRouter.post('/business-days/close', ...scoped('cash.approve'), async (req, res) => {
  res.json(await day.closeDay(actor(req)));
});

// Fiscal queue: try pending registrations now (the worker also retries on its own).
billingRouter.post('/fiscal/retry', ...scoped('settings.edit'), async (_req, res) => {
  res.json({ tried: await retryDue() });
});

// Printers, routing, print bridges, jobs (plan §5.12)
const settings = scoped('settings.edit');
billingRouter.get('/printers', ...settings, async (req, res) => {
  res.json(await printing.listPrinters(actor(req)));
});
billingRouter.post('/printers', ...settings, async (req, res) => {
  res.status(201).json(await printing.createPrinter(actor(req), req.body));
});
billingRouter.patch('/printers/:id', ...settings, async (req, res) => {
  res.json(await printing.updatePrinter(actor(req), id(req), req.body));
});
billingRouter.delete('/printers/:id', ...settings, async (req, res) => {
  await printing.deletePrinter(actor(req), id(req));
  res.status(204).end();
});
billingRouter.get('/print-routes', ...settings, async (req, res) => {
  res.json(await printing.getRoutes(actor(req)));
});
billingRouter.put('/print-routes', ...settings, async (req, res) => {
  res.json(await printing.saveRoutes(actor(req), req.body));
});
billingRouter.get('/print-bridges', ...settings, async (req, res) => {
  res.json(await printing.listBridges(actor(req)));
});
billingRouter.post('/print-bridges', ...settings, async (req, res) => {
  res.status(201).json(await printing.createBridge(actor(req), req.body));
});
billingRouter.delete('/print-bridges/:id', ...settings, async (req, res) => {
  await printing.revokeBridge(actor(req), id(req));
  res.status(204).end();
});
billingRouter.get('/print-jobs', ...settings, async (req, res) => {
  res.json(await printing.listJobs(actor(req)));
});
billingRouter.post('/print-jobs/:id/retry', ...settings, async (req: Request, res: Response) => {
  await printing.retry(actor(req), id(req));
  res.status(204).end();
});
