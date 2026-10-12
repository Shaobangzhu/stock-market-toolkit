import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

export const requestContext: RequestHandler = (_request, response, next) => {
  const requestId = randomUUID();
  response.locals.requestId = requestId;
  response.setHeader('X-Request-Id', requestId);
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  next();
};
