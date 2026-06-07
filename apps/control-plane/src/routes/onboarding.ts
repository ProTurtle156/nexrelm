import type { FastifyInstance } from 'fastify';
import type { ApiResponse } from '@nexrelm/types';
import { onboardingState, verifyTraffic } from '../core/onboarding';

function ok<T>(data: T): ApiResponse<T> {
  return { ok: true, data, error: null, meta: { generatedAt: new Date().toISOString() } };
}

/** Data + verification for the guided "put Nexrelm on the path" wizard. */
export async function registerOnboardingRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/onboarding', async () => ok(await onboardingState()));
  app.post('/api/onboarding/verify', async () => ok(await verifyTraffic()));
}
