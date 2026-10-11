import { Router } from 'express';
import { scoped } from '../../middleware/stacks.js';
import * as controller from './controller.js';

export const staffRouter = Router();

staffRouter.get('/staff', ...scoped('staff.view'), controller.list);
staffRouter.post('/staff', ...scoped('staff.manage'), controller.create);
staffRouter.patch('/staff/:id', ...scoped('staff.manage'), controller.update);
staffRouter.post('/staff/:id/credentials', ...scoped('staff.manage'), controller.setCredentials);
