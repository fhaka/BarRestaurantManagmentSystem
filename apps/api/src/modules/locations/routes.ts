import { Router } from 'express';
import { authed, scoped } from '../../middleware/stacks.js';
import * as controller from './controller.js';

export const locationsRouter = Router();

locationsRouter.get('/locations', ...authed, controller.list);
locationsRouter.get('/locations/current', ...scoped(), controller.current);
locationsRouter.post('/locations', ...scoped('location.manage'), controller.create);
locationsRouter.patch('/locations/:id', ...scoped('settings.edit'), controller.update);
