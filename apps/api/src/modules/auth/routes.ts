import { Router } from 'express';
import { authLimiter } from '../../middleware/rate-limit.js';
import { requireAuth } from '../../middleware/auth.js';
import { optionalLocation } from '../../middleware/stacks.js';
import * as controller from './controller.js';

export const authRouter = Router();

// Public: session state lives in the httpOnly refresh cookie.
authRouter.post('/auth/login', authLimiter, controller.login);
authRouter.post('/auth/refresh', controller.refresh);
authRouter.post('/auth/logout', controller.logout);
authRouter.get('/auth/pin-users', authLimiter, controller.pinUsers);
authRouter.post('/auth/pin', authLimiter, controller.pinLogin);
// Clock in/out on the shared device with a PIN, without switching who is signed in.
authRouter.post('/auth/pin-clock', authLimiter, controller.pinClock);

// Authenticated; permissions are included when X-Location-Id is sent.
authRouter.get('/me', requireAuth, optionalLocation, controller.me);
