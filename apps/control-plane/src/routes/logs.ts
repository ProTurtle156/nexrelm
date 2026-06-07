import type { FastifyInstance } from 'fastify';
import type { ApiResponse, LogLine } from '@nexrelm/types';
import { recentLogs } from '../core/logbus';

function ok<T>(data: T): ApiResponse<T> {
  return { ok: true, data, error: null, meta: { generatedAt: new Date().toISOString() } };
}

/** The unified activity log — real events from every Nexrelm module. */
export async function registerLogsRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { limit?: string; stream?: string; level?: string } }>('/api/logs', async (req) => {
    return ok<LogLine[]>(recentLogs({ limit: Number(req.query.limit) || undefined, stream: req.query.stream, level: req.query.level }));
  });
}
