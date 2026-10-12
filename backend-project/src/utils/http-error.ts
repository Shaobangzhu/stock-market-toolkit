export type ErrorCode =
  | 'NOT_FOUND' | 'METHOD_NOT_ALLOWED' | 'HOST_NOT_ALLOWED' | 'ORIGIN_NOT_ALLOWED'
  | 'PREFLIGHT_NOT_ALLOWED' | 'LOCAL_WRITE_PROTECTION' | 'UNSUPPORTED_MEDIA_TYPE'
  | 'VALIDATION_ERROR' | 'INVALID_JSON' | 'INVALID_REQUEST' | 'PAYLOAD_TOO_LARGE'
  | 'INTERNAL_ERROR' | 'DATABASE_UNAVAILABLE' | 'PROVIDER_NOT_CONFIGURED'
  | 'INVALID_SYMBOL' | 'UNSUPPORTED_INSTRUMENT' | 'PROVIDER_AUTH_FAILED'
  | 'PROVIDER_RATE_LIMITED' | 'PROVIDER_UNAVAILABLE' | 'PROVIDER_INVALID_RESPONSE'
  | 'PROVIDER_NO_DATA' | 'SYNC_BUSY' | 'AMBIGUOUS_SYMBOL' | 'SYNC_CONFLICT';

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
