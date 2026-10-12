import { Router } from 'express';
import { scoped } from '../../middleware/stacks.js';
import * as c from './controller.js';

export const ordersRouter = Router();
const create = scoped('order.create');
const send = scoped('order.send');

ordersRouter.get('/orders', ...create, c.listOrders);
ordersRouter.post('/orders', ...create, c.createOrder);
ordersRouter.get('/orders/:ref', ...create, c.getOrder);
ordersRouter.post('/orders/:ref/items', ...create, c.addItems);
ordersRouter.post('/orders/:ref/send', ...send, c.sendItems);
ordersRouter.post('/orders/:ref/fire', ...send, c.fireCourse);
ordersRouter.post('/orders/:ref/serve', ...create, c.serveItems);
ordersRouter.post('/orders/:ref/repeat', ...send, c.repeatItems);

ordersRouter.get('/table-sessions/:ref/order', ...create, c.getSessionOrder);
ordersRouter.post('/table-sessions/:ref/items', ...create, c.addSessionItems);

ordersRouter.patch('/order-items/:ref', ...create, c.updateItem);
ordersRouter.delete('/order-items/:ref', ...create, c.deleteItem);
ordersRouter.post('/order-items/:ref/void', ...scoped('order.void'), c.voidItem);
ordersRouter.post('/order-items/:ref/serve', ...create, c.serveItem);
// Kitchen and bar screens move single dishes along.
ordersRouter.patch('/order-items/:ref/status', ...scoped('kds.bump'), c.setItemStatus);

ordersRouter.get('/kds/stations', ...scoped('kds.view'), c.kdsStations);
ordersRouter.get('/kds/stations/:id/board', ...scoped('kds.view'), c.kdsBoard);
ordersRouter.post('/kds/tickets/:id/bump', ...scoped('kds.bump'), c.bumpTicket);
ordersRouter.post('/kds/tickets/:id/recall', ...scoped('kds.bump'), c.recallTicket);

ordersRouter.get('/approvers', ...scoped('order.create'), c.listApprovers);
