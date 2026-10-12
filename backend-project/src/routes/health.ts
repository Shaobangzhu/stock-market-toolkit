import { Router } from 'express';
import { z } from 'zod';
import { validateRequest } from '../middleware/validate-request.js';
import { getHealth } from '../services/health.js';
import { HttpError } from '../utils/http-error.js';

const healthRequest = z.object({
  params: z.strictObject({}),
  query: z.strictObject({}),
  body: z.undefined(),
});

export function createHealthRouter() {
  const router = Router();
  router.get('/', validateRequest(healthRequest), (_request, response) => {
    response.status(200).json({ data: getHealth() });
  });
  router.all('/', (_request, response, next) => {
    response.setHeader('Allow', 'GET, HEAD, OPTIONS');
    next(new HttpError(405, 'METHOD_NOT_ALLOWED', 'This endpoint only supports GET.'));
  });
  return router;
}
