import { expect, it, vi } from 'vitest';
import { ApiError, getApiJson } from './client';

it('uses same-origin read requests without cookies and returns safe errors', async () => {
  const fetcher = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({ error: { code: 'DATABASE_UNAVAILABLE', message: 'private detail', requestId: 'safe-id' } }) }));
  vi.stubGlobal('fetch', fetcher);
  await expect(getApiJson('/api/ready', (value) => value)).rejects.toMatchObject({ status: 503, code: 'DATABASE_UNAVAILABLE', requestId: 'safe-id' });
  expect(fetcher).toHaveBeenCalledWith('/api/ready', expect.objectContaining({ method: 'GET', credentials: 'omit' }));
  try { await getApiJson('/api/ready', (value) => value); } catch (error) { expect((error as ApiError).message).not.toContain('private detail'); }
  await expect(getApiJson('/api/../unsafe', (value) => value)).rejects.toThrow('Invalid API path');
});
