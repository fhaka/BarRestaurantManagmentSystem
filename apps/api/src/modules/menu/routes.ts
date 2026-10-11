import { Router } from 'express';
import multer from 'multer';
import { MAX_IMAGE_BYTES } from '../../lib/images.js';
import { scoped } from '../../middleware/stacks.js';
import * as c from './controller.js';

// Images are kept in memory only long enough to be checked and re-encoded by sharp.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 0 },
}).single('image');

export const menuRouter = Router();
const edit = scoped('menu.edit');

menuRouter.get('/menu', ...scoped('menu.view'), c.getMenu);
menuRouter.get('/menu/guest-preview', ...scoped('menu.view'), c.guestPreview);
menuRouter.get('/menu/export', ...edit, c.exportCsv);
menuRouter.post('/menu/import', ...edit, c.importCsv);

menuRouter.post('/menu/categories', ...edit, c.createCategory);
menuRouter.post('/menu/categories/reorder', ...edit, c.reorderCategories);
menuRouter.patch('/menu/categories/:id', ...edit, c.updateCategory);
menuRouter.delete('/menu/categories/:id', ...edit, c.deleteCategory);
menuRouter.post('/menu/categories/:id/image', ...edit, upload, c.setCategoryImage);
menuRouter.post('/menu/categories/:id/items/reorder', ...edit, c.reorderItems);

menuRouter.post('/menu/items', ...edit, c.createItem);
menuRouter.patch('/menu/items/:id', ...edit, c.updateItem);
menuRouter.delete('/menu/items/:id', ...edit, c.deleteItem);
menuRouter.post('/menu/items/:id/image', ...edit, upload, c.setItemImage);
menuRouter.delete('/menu/items/:id/image', ...edit, c.removeItemImage);
// Kitchen and bar screens can 86 items too (plan §5.3).
menuRouter.post('/menu/items/:id/out-of-stock', ...scoped('menu.availability'), c.setOutOfStock);

menuRouter.post('/menu/modifier-groups', ...edit, c.createModifierGroup);
menuRouter.patch('/menu/modifier-groups/:id', ...edit, c.updateModifierGroup);
menuRouter.delete('/menu/modifier-groups/:id', ...edit, c.deleteModifierGroup);

menuRouter.post('/menu/price-rules', ...edit, c.createPriceRule);
menuRouter.patch('/menu/price-rules/:id', ...edit, c.updatePriceRule);
menuRouter.delete('/menu/price-rules/:id', ...edit, c.deletePriceRule);

menuRouter.post('/stations', ...edit, c.createStation);
menuRouter.patch('/stations/:id', ...edit, c.updateStation);
menuRouter.post('/tax-rates', ...scoped('settings.edit'), c.createTaxRate);
menuRouter.patch('/tax-rates/:id', ...scoped('settings.edit'), c.updateTaxRate);
