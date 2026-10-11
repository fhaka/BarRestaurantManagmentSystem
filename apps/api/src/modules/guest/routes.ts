import { Router } from 'express';
import { z } from 'zod';
import { guestLimiter } from '../../middleware/rate-limit.js';
import { buildGuestMenu } from '../menu/guest.js';

/**
 * Public guest endpoints (no account). Phase 5 adds the table-token routes
 * (/guest/t/:tableToken) on top of the same menu builder.
 */
export const guestRouter = Router();

const params = z.object({ locationId: z.coerce.number().int().positive() });
const query = z.object({ lang: z.string().max(5).optional() });

guestRouter.get('/guest/locations/:locationId/menu', guestLimiter, async (req, res) => {
  const { locationId } = params.parse(req.params);
  const { lang } = query.parse(req.query);
  const menu = await buildGuestMenu(locationId, {
    lang,
    acceptLanguage: req.get('accept-language') ?? undefined,
  });
  // Prices can change with happy hour, so caches must revalidate soon.
  res.set('Cache-Control', 'public, max-age=30').json(menu);
});
