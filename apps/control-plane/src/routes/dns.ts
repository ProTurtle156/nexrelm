import type { FastifyInstance } from 'fastify';
import type { ApiResponse, DnsListType, DnsResolverSettings } from '@nexrelm/types';
import {
  adlistAdd,
  adlistDelete,
  adlistUpdate,
  adlistsAll,
  applyDnsSettings,
  blockingState,
  clientGroupsSet,
  clientNicknameSet,
  clientsAll,
  computeStats,
  dnsStatus,
  setBlockingState,
  domainAdd,
  domainDelete,
  domainSearch,
  domainUpdate,
  domainsAll,
  getSettings,
  groupAdd,
  groupDelete,
  groupUpdate,
  groupsAll,
  queriesRecent,
  rebuildGravity,
  recompile,
  resolver,
  UPSTREAM_PRESETS,
} from '../dns';

function ok<T>(data: T): ApiResponse<T> {
  return { ok: true, data, error: null, meta: { generatedAt: new Date().toISOString() } };
}
function fail(error: string): ApiResponse<null> {
  return { ok: false, data: null, error };
}

/** The real DNS resolver control surface (Pi-hole-style). */
export async function registerDnsRoutes(app: FastifyInstance): Promise<void> {
  // ── status + stats ──────────────────────────────────────────────────────────
  app.get('/api/dns/status', async () => ok(dnsStatus()));
  app.get('/api/dns/stats', async () => ok(computeStats()));

  // ── blocking on/off (timed or indefinite) ──────────────────────────────────────
  app.get('/api/dns/blocking', async () => ok(blockingState()));
  app.post<{ Body: { action: 'enable' | 'disable'; seconds?: number } }>('/api/dns/blocking', async (req, reply) => {
    const action = req.body?.action;
    if (action !== 'enable' && action !== 'disable') {
      reply.code(400);
      return fail('action must be enable | disable');
    }
    return ok(setBlockingState(action, req.body?.seconds));
  });

  // ── query log ─────────────────────────────────────────────────────────────────
  app.get<{ Querystring: { limit?: string; offset?: string; domain?: string; client?: string; status?: string } }>(
    '/api/dns/queries',
    async (req) => {
      const q = req.query;
      return ok(
        queriesRecent({
          limit: q.limit ? Number(q.limit) : undefined,
          offset: q.offset ? Number(q.offset) : undefined,
          domain: q.domain,
          client: q.client,
          status: q.status as never,
        }),
      );
    },
  );

  // ── clients ─────────────────────────────────────────────────────────────────
  app.get('/api/dns/clients', async () => ok(clientsAll()));
  app.post<{ Params: { id: string }; Body: { groups: number[] } }>('/api/dns/clients/:id/groups', async (req) => {
    clientGroupsSet(Number(req.params.id), req.body?.groups ?? []);
    recompile();
    return ok({ id: Number(req.params.id) });
  });
  app.post<{ Params: { id: string }; Body: { nickname: string } }>('/api/dns/clients/:id/nickname', async (req) => {
    clientNicknameSet(Number(req.params.id), req.body?.nickname ?? '');
    return ok({ id: Number(req.params.id) });
  });

  // ── block/allow lists ─────────────────────────────────────────────────────────
  app.get<{ Querystring: { type?: DnsListType } }>('/api/dns/lists', async (req) => ok(domainsAll(req.query.type)));
  app.post<{ Body: { type: DnsListType; kind?: 'exact' | 'regex'; domain: string; comment?: string; groups?: number[] } }>(
    '/api/dns/lists',
    async (req, reply) => {
      const b = req.body;
      if (!b?.domain || (b.type !== 'block' && b.type !== 'allow')) {
        reply.code(400);
        return fail('type (block|allow) and domain are required');
      }
      const entry = domainAdd({ type: b.type, kind: b.kind ?? 'exact', domain: b.domain, comment: b.comment, groups: b.groups });
      recompile();
      return ok(entry);
    },
  );
  app.patch<{ Params: { id: string }; Body: { enabled?: boolean; comment?: string; groups?: number[]; priority?: number } }>(
    '/api/dns/lists/:id',
    async (req) => {
      domainUpdate(Number(req.params.id), req.body ?? {});
      recompile();
      return ok({ id: Number(req.params.id) });
    },
  );
  app.delete<{ Params: { id: string } }>('/api/dns/lists/:id', async (req) => {
    domainDelete(Number(req.params.id));
    recompile();
    return ok({ id: Number(req.params.id) });
  });

  // ── search across every list ───────────────────────────────────────────────────
  app.get<{ Querystring: { q?: string } }>('/api/dns/search', async (req) => {
    const q = (req.query.q ?? '').trim();
    return ok(q ? domainSearch(q) : []);
  });

  // ── adlists + gravity ─────────────────────────────────────────────────────────
  app.get('/api/dns/adlists', async () => ok(adlistsAll()));
  app.post<{ Body: { url: string; comment?: string; groups?: number[]; type?: DnsListType; priority?: number } }>('/api/dns/adlists', async (req, reply) => {
    if (!req.body?.url) {
      reply.code(400);
      return fail('url is required');
    }
    return ok(adlistAdd(req.body.url, req.body.comment, req.body.groups, req.body.type ?? 'block', req.body.priority ?? 100));
  });
  app.patch<{ Params: { id: string }; Body: { enabled?: boolean; comment?: string; groups?: number[]; type?: DnsListType; priority?: number } }>(
    '/api/dns/adlists/:id',
    async (req) => {
      adlistUpdate(Number(req.params.id), req.body ?? {});
      recompile();
      return ok({ id: Number(req.params.id) });
    },
  );
  app.delete<{ Params: { id: string } }>('/api/dns/adlists/:id', async (req) => {
    adlistDelete(Number(req.params.id));
    recompile();
    return ok({ id: Number(req.params.id) });
  });
  app.post('/api/dns/gravity', async () => ok(await rebuildGravity()));

  // ── groups ─────────────────────────────────────────────────────────────────
  app.get('/api/dns/groups', async () => ok(groupsAll()));
  app.post<{ Body: { name: string; comment?: string } }>('/api/dns/groups', async (req, reply) => {
    if (!req.body?.name) {
      reply.code(400);
      return fail('name is required');
    }
    return ok({ id: groupAdd(req.body.name, req.body.comment) });
  });
  app.patch<{ Params: { id: string }; Body: { name?: string; enabled?: boolean; comment?: string } }>('/api/dns/groups/:id', async (req) => {
    groupUpdate(Number(req.params.id), req.body ?? {});
    recompile();
    return ok({ id: Number(req.params.id) });
  });
  app.delete<{ Params: { id: string } }>('/api/dns/groups/:id', async (req) => {
    groupDelete(Number(req.params.id));
    recompile();
    return ok({ id: Number(req.params.id) });
  });

  // ── settings + upstream presets + control ───────────────────────────────────────
  app.get('/api/dns/settings', async () => ok(getSettings()));
  app.patch<{ Body: Partial<DnsResolverSettings> }>('/api/dns/settings', async (req) => ok(await applyDnsSettings(req.body ?? {})));
  app.get('/api/dns/upstreams', async () => ok(UPSTREAM_PRESETS));

  app.post<{ Body: { action: 'start' | 'stop' | 'restart' } }>('/api/dns/control', async (req, reply) => {
    const action = req.body?.action;
    if (action === 'stop') {
      await resolver.stop();
      return ok(resolver.status());
    }
    if (action === 'start' || action === 'restart') {
      recompile();
      return ok(await resolver.start(getSettings()));
    }
    reply.code(400);
    return fail('action must be start | stop | restart');
  });
}
