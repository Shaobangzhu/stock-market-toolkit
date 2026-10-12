import type { RequestHandler } from 'express';
import type { z } from 'zod';
import { HttpError } from '../utils/http-error.js';

// Read parsed/coerced values from response.locals.validated; Express 5 query is a getter.
export function validateRequest(schema: z.ZodType): RequestHandler {
  return (request, response, next) => {
    const result = schema.safeParse({
      params: request.params,
      query: request.query,
      body: request.body,
    });
    if (!result.success) {
      // Do not reflect input, unknown property names, or custom schema messages.
      next(new HttpError(400, 'VALIDATION_ERROR', 'Request validation failed.'));
      return;
    }
    response.locals.validated = result.data;
    next();
  };
}
