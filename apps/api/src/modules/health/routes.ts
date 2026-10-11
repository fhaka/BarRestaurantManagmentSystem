import { Router } from 'express';
import type { HealthResponse } from '@tavolina/shared';
import { getHealth } from './service.js';

export const healthRouter = Router();

healthRouter.get('/health', async (_req, res) => {
  const health: HealthResponse = await getHealth();
  res.status(health.status === 'ok' ? 200 : 503).json(health);
});
