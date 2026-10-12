export interface ApiErrorBody {
  error?: { code?: string; message?: string; requestId?: string };
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly requestId?: string,
  ) {
    super('The local data service could not complete this request.');
    this.name = 'ApiError';
  }
}

// All browser requests stay on the same local origin and under /api/.
export async function getApiJson<T>(
  path: `/api/${string}`,
  decode: (value: unknown) => T,
  signal?: AbortSignal,
): Promise<T> {
  if (path.includes('://') || path.includes('..')) throw new Error('Invalid API path.');
  const response = await fetch(path, {
    method: 'GET',
    signal,
    credentials: 'omit',
    headers: { Accept: 'application/json' },
  });
  const payload: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const error = payload && typeof payload === 'object' && 'error' in payload
      ? (payload as ApiErrorBody).error : undefined;
    throw new ApiError(response.status, error?.code ?? 'REQUEST_FAILED', error?.requestId);
  }
  return decode(payload);
}

export interface DatabaseReadiness {
  status: 'ready';
  database: 'ok';
}

function decodeReadiness(value: unknown): DatabaseReadiness {
  if (value && typeof value === 'object' && 'data' in value) {
    const data = (value as { data: unknown }).data;
    if (data && typeof data === 'object' && 'status' in data && 'database' in data
      && data.status === 'ready' && data.database === 'ok') {
      return { status: 'ready', database: 'ok' };
    }
  }
  throw new Error('The local data service returned an unexpected response.');
}

export const readinessQuery = {
  queryKey: ['database', 'readiness'] as const,
  queryFn: ({ signal }: { signal: AbortSignal }) => getApiJson('/api/ready', decodeReadiness, signal),
  retry: false,
  staleTime: 30_000,
};
