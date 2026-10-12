import { Router } from 'express';
import { createHealthRouter } from './health.js';
import { createReadyRouter } from './ready.js';
import type { DatabaseHealth } from '../services/database.js';

export function createApiRouter(database?: DatabaseHealth) {
  const router = Router();
  router.use('/health', createHealthRouter());
  router.use('/ready', createReadyRouter(database));
  return router;
}
