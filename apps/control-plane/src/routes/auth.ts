import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ApiResponse } from '@nexrelm/types';
import { changePassword, isAuthInitialized, login, logout, verifyToken } from '../core/auth';

function ok<T>(data: T): ApiResponse<T> {
  return { ok: true, data, error: null, meta: { generatedAt: new Date().toISOString() } };
}
function fail(error: string): ApiResponse<null> {
  return { ok: false, data: null, error };
}

const bearer = (req: FastifyRequest): string | undefined => {
  const h = req.headers.authorization;
  return h?.startsWith('Bearer ') ? h.slice(7) : undefined;
};

const ctxOf = (req: FastifyRequest): { ip?: string; ua?: string } => ({ ip: req.ip, ua: req.headers['user-agent'] });

/**
 * Login surface. status/login are public; the rest needs a session. Account
 * creation is intentionally NOT here — it's done by the bash installer / the
 * `nexrelm` CLI (in-process), so the admin password is only ever born on the
 * server console, never over HTTP.
 */
export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/auth/status', async () => ok({ initialized: isAuthInitialized() }));

  app.post<{ Body: { username?: string; password?: string } }>('/api/auth/login', async (req, reply) => {
    const result = await login(String(req.body?.username ?? ''), String(req.body?.password ?? ''), ctxOf(req));
    if ('session' in result) return ok(result.session);
    if (result.error === 'locked') {
      reply.code(429).header('retry-after', String(result.retryAfterSec));
      return fail(`too many attempts — locked, try again in ${Math.ceil(result.retryAfterSec / 60)} min`);
    }
    reply.code(401);
    return fail('invalid username or password');
  });

  app.get('/api/auth/me', async (req, reply) => {
    const me = verifyToken(bearer(req), ctxOf(req));
    if (!me) {
      reply.code(401);
      return fail('unauthorized');
    }
    return ok(me);
  });

  app.post('/api/auth/logout', async (req) => {
    logout(bearer(req));
    return ok({ done: true });
  });

  app.post<{ Body: { currentPassword?: string; newPassword?: string } }>('/api/auth/password', async (req, reply) => {
    try {
      changePassword(bearer(req), String(req.body?.currentPassword ?? ''), String(req.body?.newPassword ?? ''));
      return ok({ changed: true });
    } catch (e) {
      const m = e instanceof Error ? e.message : 'change failed';
      reply.code(m === 'unauthorized' ? 401 : 400);
      return fail(m);
    }
  });
}
