export type ErrorCode =
  | 'NOT_FOUND' | 'METHOD_NOT_ALLOWED' | 'HOST_NOT_ALLOWED' | 'ORIGIN_NOT_ALLOWED'
  | 'PREFLIGHT_NOT_ALLOWED' | 'LOCAL_WRITE_PROTECTION' | 'UNSUPPORTED_MEDIA_TYPE'
  | 'VALIDATION_ERROR' | 'INVALID_JSON' | 'INVALID_REQUEST' | 'PAYLOAD_TOO_LARGE'
  | 'INTERNAL_ERROR' | 'DATABASE_UNAVAILABLE';

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    public readonly publicMessage: string,
  ) {
    super(publicMessage);
    this.name = 'HttpError';
  }
}
