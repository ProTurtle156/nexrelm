import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { config } from './config';
import { registerRest } from './routes/rest';
import { registerWs } from './routes/ws';
import { registerDnsRoutes } from './routes/dns';
import { registerDhcpRoutes } from './routes/dhcp';
import { registerDirectoryRoutes } from './routes/directory';
import { registerVmRoutes } from './routes/vms';
import { registerSecurityRoutes } from './routes/security';
import { registerLogsRoutes } from './routes/logs';
import { registerSystemRoutes } from './routes/system';
import { registerOnboardingRoutes } from './routes/onboarding';
import { registerAuthRoutes } from './routes/auth';
import { isAuthInitialized, verifyToken } from './core/auth';

// Endpoints that must stay reachable without a session: the login flow itself,
// and /api/health so external uptime monitors keep working.
const PUBLIC_PATHS = new Set(['/api/auth/status', '/api/auth/login', '/api/health']);

/** Build the configured (but not yet listening) Fastify instance. HTTPS when TLS is configured. */
export async function buildServer(): Promise<FastifyInstance> {
  // Options built as a single object (and `any`-cast) so the HTTPS vs HTTP branch
  // doesn't widen the instance to an incompatible union type. trustProxy='loopback'
  // honours X-Forwarded-For only from a same-host reverse proxy (Caddyfile) — a
  // direct client can't spoof req.ip (used for lockout context + audit logging).
  const opts: Record<string, unknown> = { logger: false, trustProxy: 'loopback' };
  if (config.tls) opts.https = { key: config.tls.key, cert: config.tls.cert };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const app = Fastify(opts as any) as unknown as FastifyInstance;

  await app.register(cors, { origin: config.corsOrigin });
  await app.register(websocket);

  // ── security headers ─────────────────────────────────────────────────────────
  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Cross-Origin-Resource-Policy', 'same-site');
    reply.header('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    if (config.tls) reply.header('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
    return payload;
  });

  // ── auth guard ──────────────────────────────────────────────────────────────
  // Open until the install wizard creates the admin account; afterwards every
  // /api + /ws request needs a bearer session (the WS passes ?token= because
  // browsers can't set headers on WebSocket upgrades).
  app.addHook('onRequest', async (req, reply) => {
    const [pathOnly, query = ''] = req.url.split('?');
    if (!pathOnly!.startsWith('/api') && pathOnly !== '/ws') return;
    if (!isAuthInitialized()) return;
    if (PUBLIC_PATHS.has(pathOnly!)) return;
    const header = req.headers.authorization;
    let token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    // WebSocket upgrades (/ws and the SSH-shell bridges at /api/*/shell) can't set
    // an Authorization header, so they pass ?token=. Read it for any guarded path.
    if (!token) token = new URLSearchParams(query).get('token') ?? undefined;
    if (verifyToken(token, { ip: req.ip, ua: req.headers['user-agent'] })) return;
    reply.code(401).send({ ok: false, data: null, error: 'unauthorized' });
  });

  await registerAuthRoutes(app);
  await registerRest(app);
  await registerWs(app);
  await registerDnsRoutes(app);
  await registerDhcpRoutes(app);
  await registerDirectoryRoutes(app);
  await registerVmRoutes(app);
  await registerSecurityRoutes(app);
  await registerLogsRoutes(app);
  await registerSystemRoutes(app);
  await registerOnboardingRoutes(app);

  return app;
}
