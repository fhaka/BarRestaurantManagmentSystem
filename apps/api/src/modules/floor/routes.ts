import { Router } from 'express';
import { scoped } from '../../middleware/stacks.js';
import * as c from './controller.js';

export const floorRouter = Router();
const edit = scoped('floor.edit');

floorRouter.get('/floor', ...scoped('floor.view'), c.getFloor);

floorRouter.post('/areas', ...edit, c.createArea);
floorRouter.patch('/areas/:id', ...edit, c.updateArea);
floorRouter.delete('/areas/:id', ...edit, c.deleteArea);
floorRouter.get('/areas/:id/qr-sheet', ...edit, c.areaQrSheet);

floorRouter.post('/tables', ...edit, c.createTable);
floorRouter.post('/tables/layout', ...edit, c.saveLayout);
floorRouter.patch('/tables/:id', ...edit, c.updateTable);
floorRouter.delete('/tables/:id', ...edit, c.deleteTable);
floorRouter.get('/tables/:id/qr', ...edit, c.tableQr);
floorRouter.post('/tables/:id/qr/rotate', ...edit, c.rotateQr);
floorRouter.post('/tables/:id/clean', ...scoped('table.open'), c.markClean);

floorRouter.post('/table-sessions', ...scoped('table.open'), c.openSession);
floorRouter.patch('/table-sessions/:id', ...scoped('table.open'), c.updateSession);
floorRouter.post('/table-sessions/:id/transfer', ...scoped('table.transfer'), c.transferSession);
floorRouter.post('/table-sessions/:id/merge', ...scoped('table.transfer'), c.mergeSession);
floorRouter.post('/table-sessions/:id/split', ...scoped('table.transfer'), c.splitSession);
floorRouter.post('/table-sessions/:id/request-bill', ...scoped('table.open'), c.requestBill);
floorRouter.post('/table-sessions/:id/reopen', ...scoped('table.open'), c.reopenSession);
floorRouter.post('/table-sessions/:id/close', ...scoped('table.close'), c.closeSession);
