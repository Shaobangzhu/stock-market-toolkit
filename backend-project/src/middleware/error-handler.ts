import type { ErrorRequestHandler, RequestHandler } from 'express';
import { HttpError } from '../utils/http-error.js';
import type { Logger } from '../utils/logger.js';

export const notFound: RequestHandler = (_request, _response, next) => {
  next(new HttpError(404, 'NOT_FOUND', 'Endpoint not found.'));
};

function publicError(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  if (error instanceof URIError) {
    return new HttpError(400, 'INVALID_REQUEST', 'Invalid request path.');
  }
  if (typeof error === 'object' && error !== null && 'type' in error) {
    // Only recognize body-parser errors from Express's built-in parsers.
    switch (error.type) {
      case 'entity.parse.failed':
        return new HttpError(400, 'INVALID_JSON', 'Request body could not be parsed.');
      case 'entity.too.large':
      case 'parameters.too.many':
        return new HttpError(413, 'PAYLOAD_TOO_LARGE', 'Request payload is too large.');
      case 'encoding.unsupported':
      case 'charset.unsupported':
        return new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Request encoding is not supported.');
      case 'request.aborted':
      case 'request.size.invalid':
        return new HttpError(400, 'INVALID_REQUEST', 'Invalid request body.');
    }
  }
  return new HttpError(500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
}

export function errorHandler(log: Logger): ErrorRequestHandler {
  return (error: unknown, _request, response, _next) => {
    const failure = publicError(error);
    const requestId = response.locals.requestId as string;
    // Raw exception messages, stack traces, headers, bodies and URLs can contain keys.
    log.error({ event: 'request_failed', requestId, status: failure.status, code: failure.code });
    if (response.headersSent) {
      // Close rather than hand the secret-bearing error to Express's default logger.
      response.destroy();
      return;
    }
    response.status(failure.status).json({
      error: { code: failure.code, message: failure.publicMessage, requestId },
    });
  };
}
