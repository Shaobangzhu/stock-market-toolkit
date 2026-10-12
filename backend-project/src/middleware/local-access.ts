import type { RequestHandler } from 'express';
import type { AppConfig } from '../config/env.js';
import { HttpError } from '../utils/http-error.js';

const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);
const methods = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']);
const allowedHeaders = new Set(['content-type', 'x-stock-research-lab']);

export function localAccess(config: AppConfig): RequestHandler {
  const backendOrigins = [
    `http://127.0.0.1:${config.PORT}`,
    `http://localhost:${config.PORT}`,
  ];
  const hosts = new Set(backendOrigins.map((origin) => new URL(origin).host));

  return (request, response, next) => {
    const host = (request.get('host') ?? '').toLowerCase();
    if (!hosts.has(host)) {
      next(new HttpError(403, 'HOST_NOT_ALLOWED', 'Request host is not allowed.'));
      return;
    }
    const origin = request.get('origin');
    if ((origin !== undefined && origin !== config.FRONTEND_ORIGIN && origin !== `http://${host}`)
      || request.get('sec-fetch-site') === 'cross-site') {
      next(new HttpError(403, 'ORIGIN_NOT_ALLOWED', 'Request origin is not allowed.'));
      return;
    }

    // Browser reads from the configured frontend (or our own local origin) only.
    response.vary('Origin');
    if (origin === config.FRONTEND_ORIGIN) {
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Access-Control-Expose-Headers', 'X-Request-Id');
    }

    if (request.method === 'OPTIONS') {
      const method = request.get('access-control-request-method');
      if (method !== undefined) {
        response.vary('Access-Control-Request-Method');
        response.vary('Access-Control-Request-Headers');
        const headers = (request.get('access-control-request-headers') ?? '')
          .split(',').map((header) => header.trim().toLowerCase()).filter(Boolean);
        if (!origin || !methods.has(method) || headers.some((header) => !allowedHeaders.has(header))) {
          next(new HttpError(403, 'PREFLIGHT_NOT_ALLOWED', 'Preflight request is not allowed.'));
          return;
        }
        response.setHeader('Access-Control-Allow-Methods', [...methods].join(', '));
        response.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Stock-Research-Lab');
      }
      response.sendStatus(204);
      return;
    }

    if (!safeMethods.has(request.method)) {
      if (!origin || request.get('x-stock-research-lab') !== '1') {
        next(new HttpError(403, 'LOCAL_WRITE_PROTECTION',
          'Writes require an allowed Origin and X-Stock-Research-Lab: 1.'));
        return;
      }
      if (!request.is('application/json')) {
        next(new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Writes require application/json.'));
        return;
      }
    }
    next();
  };
}
