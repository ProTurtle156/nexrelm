import type { FastifyInstance } from 'fastify';
import type { ApiResponse, SystemSettings } from '@nexrelm/types';
import { pruneNow, saveSystemSettings, systemInfo } from '../core/system-settings';

function ok<T>(data: T): ApiResponse<T> {
  return { ok: true, data, error: null, meta: { generatedAt: new Date().toISOString() } };
}

/** Backend system settings: retention windows, log buffer, storage footprint. */
export async function registerSystemRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/system/settings', async () => ok(systemInfo()));
  app.post<{ Body: Partial<SystemSettings> }>('/api/system/settings', async (req) => {
    await saveSystemSettings(req.body ?? {});
    return ok(systemInfo());
  });
  app.post('/api/system/prune', async () => ok(pruneNow()));
}
