import express, { type Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import { API_BASE_PATH } from '@tavolina/shared';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { requestId } from './middleware/request-id.js';
import { errorHandler, notFound } from './middleware/error-handler.js';
import { healthRouter } from './modules/health/routes.js';
import { apiLimiter } from './middleware/rate-limit.js';
import { authRouter } from './modules/auth/routes.js';
import { approvalsRouter } from './modules/approvals/routes.js';
import { locationsRouter } from './modules/locations/routes.js';
import { staffRouter } from './modules/staff/routes.js';
import { menuRouter } from './modules/menu/routes.js';
import { guestRouter } from './modules/guest/routes.js';
import { floorRouter } from './modules/floor/routes.js';
import { ordersRouter } from './modules/orders/routes.js';
import { billingRouter } from './modules/billing/routes.js';
import { inventoryRouter } from './modules/inventory/routes.js';
import { reservationsRouter } from './modules/reservations/routes.js';
import { timeRouter } from './modules/time/routes.js';
import { reportsRouter } from './modules/reports/routes.js';
import { auditRouter } from './modules/audit/routes.js';
import { UPLOADS_PUBLIC_PATH, uploadsDir } from './lib/storage.js';

export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as express.Request).id,
      autoLogging: { ignore: (req) => req.url?.endsWith('/health') ?? false },
    }),
  );
  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGINS,
      credentials: true,
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Location-Id',
        'Idempotency-Key',
        'X-Request-Id',
      ],
      exposedHeaders: ['X-Request-Id'],
    }),
  );
  // Uploaded files get unique names, so they can be cached forever.
  app.use(
    UPLOADS_PUBLIC_PATH,
    express.static(uploadsDir, {
      immutable: true,
      maxAge: '365d',
      index: false,
      fallthrough: false,
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  const api = express.Router();
  api.use(healthRouter);
  api.use(apiLimiter);
  api.use(authRouter);
  api.use(locationsRouter);
  api.use(staffRouter);
  api.use(approvalsRouter);
  api.use(menuRouter);
  api.use(floorRouter);
  api.use(ordersRouter);
  api.use(billingRouter);
  api.use(inventoryRouter);
  api.use(reservationsRouter);
  api.use(timeRouter);
  api.use(reportsRouter);
  api.use(auditRouter);
  api.use(guestRouter);
  app.use(API_BASE_PATH, api);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
