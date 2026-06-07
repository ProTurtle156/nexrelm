import type { FastifyInstance } from 'fastify';
import type { ApiResponse, DhcpFilterType, DhcpOptionValue, DhcpReservationType, DhcpScopeDef, DhcpServerSettings } from '@nexrelm/types';
import { probeDhcpServers, lastProbe } from '../dhcp/probe';
import { pushLog } from '../core/logbus';
import {
  applyDhcpSettings,
  computeDhcpStats,
  dhcpStatus,
  exclusionAdd,
  exclusionDelete,
  exclusionsAll,
  filterAdd,
  filterDelete,
  filtersAll,
  getFilterSettings,
  getServerOptions,
  getServerSettings,
  intToIp,
  ipToInt,
  leaseDelete,
  leasesAll,
  OPTION_CATALOG,
  policiesAll,
  policyAdd,
  policyDelete,
  policyUpdate,
  reservationAdd,
  reservationDelete,
  reservationsAll,
  saveFilterSettings,
  saveServerOptions,
  scopeAdd,
  scopeDelete,
  scopeUpdate,
  scopesAll,
} from '../dhcp';

function ok<T>(data: T): ApiResponse<T> {
  return { ok: true, data, error: null, meta: { generatedAt: new Date().toISOString() } };
}
function fail(error: string): ApiResponse<null> {
  return { ok: false, data: null, error };
}

/** The DHCP server control surface (Windows-DHCP-parity). */
export async function registerDhcpRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/dhcp/status', async () => ok(dhcpStatus()));
  app.get('/api/dhcp/stats', async () => ok(computeDhcpStats()));

  // active DHCP discovery probe — find every DHCP server (and any rogue) on the LAN
  app.get('/api/dhcp/probe', async () => ok(lastProbe()));
  app.post('/api/dhcp/probe', async () => {
    const result = await probeDhcpServers();
    if (result.servers.length) pushLog('dhcp', result.rogue ? 'warn' : 'info', `DHCP probe: ${result.servers.length} server(s) answered — ${result.servers.map((s) => s.server).join(', ')}${result.rogue ? ' (multiple → rogue present)' : ''}`);
    else pushLog('dhcp', 'info', 'DHCP probe: no servers answered on this segment');
    return ok(result);
  });
  app.get('/api/dhcp/option-catalog', async () => ok(OPTION_CATALOG));

  // ── settings + server options + control ────────────────────────────────────────
  app.get('/api/dhcp/settings', async () => ok(getServerSettings()));
  app.patch<{ Body: Partial<DhcpServerSettings> }>('/api/dhcp/settings', async (req) => ok(await applyDhcpSettings(req.body ?? {})));
  app.post<{ Body: { action: 'start' | 'stop' } }>('/api/dhcp/control', async (req, reply) => {
    const a = req.body?.action;
    if (a !== 'start' && a !== 'stop') {
      reply.code(400);
      return fail('action must be start | stop');
    }
    return ok(await applyDhcpSettings({ enabled: a === 'start' }));
  });
  app.get('/api/dhcp/server-options', async () => ok(getServerOptions()));
  app.put<{ Body: { options: DhcpOptionValue[] } }>('/api/dhcp/server-options', async (req) => ok(saveServerOptions(req.body?.options ?? [])));

  // ── scopes ─────────────────────────────────────────────────────────────────────
  app.get('/api/dhcp/scopes', async () => ok(scopesAll()));
  app.post<{ Body: Omit<DhcpScopeDef, 'id'> }>('/api/dhcp/scopes', async (req, reply) => {
    const b = req.body;
    if (!b?.name || !b.rangeStart || !b.rangeEnd || !b.mask) {
      reply.code(400);
      return fail('name, mask, rangeStart and rangeEnd are required');
    }
    const subnet = b.subnet || intToIp((ipToInt(b.rangeStart) & ipToInt(b.mask)) >>> 0);
    return ok(
      scopeAdd({
        name: b.name,
        description: b.description,
        state: b.state ?? 'active',
        subnet,
        mask: b.mask,
        rangeStart: b.rangeStart,
        rangeEnd: b.rangeEnd,
        leaseSeconds: b.leaseSeconds ?? 86400,
        dnsMode: b.dnsMode ?? 'inherit',
        dnsServers: b.dnsServers ?? [],
        options: b.options ?? [],
      }),
    );
  });
  app.patch<{ Params: { id: string }; Body: Partial<DhcpScopeDef> }>('/api/dhcp/scopes/:id', async (req) => {
    scopeUpdate(req.params.id, req.body ?? {});
    return ok({ id: req.params.id });
  });
  app.delete<{ Params: { id: string } }>('/api/dhcp/scopes/:id', async (req) => {
    scopeDelete(req.params.id);
    return ok({ id: req.params.id });
  });

  // ── exclusions ───────────────────────────────────────────────────────────────────
  app.get<{ Querystring: { scopeId?: string } }>('/api/dhcp/exclusions', async (req) => ok(exclusionsAll(req.query.scopeId)));
  app.post<{ Body: { scopeId: string; start: string; end: string } }>('/api/dhcp/exclusions', async (req, reply) => {
    const b = req.body;
    if (!b?.scopeId || !b.start || !b.end) {
      reply.code(400);
      return fail('scopeId, start, end required');
    }
    return ok(exclusionAdd(b.scopeId, b.start, b.end));
  });
  app.delete<{ Params: { id: string } }>('/api/dhcp/exclusions/:id', async (req) => {
    exclusionDelete(req.params.id);
    return ok({ id: req.params.id });
  });

  // ── reservations ─────────────────────────────────────────────────────────────────
  app.get<{ Querystring: { scopeId?: string } }>('/api/dhcp/reservations', async (req) => ok(reservationsAll(req.query.scopeId)));
  app.post<{ Body: { scopeId: string; ip: string; mac: string; name?: string; description?: string; supported?: DhcpReservationType; options?: DhcpOptionValue[] } }>(
    '/api/dhcp/reservations',
    async (req, reply) => {
      const b = req.body;
      if (!b?.scopeId || !b.ip || !b.mac) {
        reply.code(400);
        return fail('scopeId, ip, mac required');
      }
      return ok(reservationAdd({ scopeId: b.scopeId, ip: b.ip, mac: b.mac, name: b.name, description: b.description, supported: b.supported ?? 'both', options: b.options ?? [] }));
    },
  );
  app.delete<{ Params: { id: string } }>('/api/dhcp/reservations/:id', async (req) => {
    reservationDelete(req.params.id);
    return ok({ id: req.params.id });
  });

  // ── leases ─────────────────────────────────────────────────────────────────────
  app.get<{ Querystring: { scopeId?: string } }>('/api/dhcp/leases', async (req) => ok(leasesAll(req.query.scopeId)));
  app.delete<{ Params: { ip: string } }>('/api/dhcp/leases/:ip', async (req) => {
    leaseDelete(req.params.ip);
    return ok({ ip: req.params.ip });
  });

  // ── filters ─────────────────────────────────────────────────────────────────────
  app.get('/api/dhcp/filters', async () => ok({ settings: getFilterSettings(), filters: filtersAll() }));
  app.post<{ Body: { mac: string; type: DhcpFilterType; description?: string } }>('/api/dhcp/filters', async (req, reply) => {
    if (!req.body?.mac || (req.body.type !== 'allow' && req.body.type !== 'deny')) {
      reply.code(400);
      return fail('mac and type (allow|deny) required');
    }
    return ok(filterAdd(req.body.mac, req.body.type, req.body.description));
  });
  app.delete<{ Params: { id: string } }>('/api/dhcp/filters/:id', async (req) => {
    filterDelete(req.params.id);
    return ok({ id: req.params.id });
  });
  app.patch<{ Body: { allowEnabled?: boolean; denyEnabled?: boolean } }>('/api/dhcp/filter-settings', async (req) => ok(saveFilterSettings(req.body ?? {})));

  // ── policies ─────────────────────────────────────────────────────────────────────
  app.get<{ Querystring: { scopeId?: string } }>('/api/dhcp/policies', async (req) => ok(policiesAll(req.query.scopeId)));
  app.post<{ Body: { scopeId: string; name: string; conditionType: 'mac' | 'vendor' | 'user'; conditionValue: string; options?: DhcpOptionValue[] } }>(
    '/api/dhcp/policies',
    async (req, reply) => {
      const b = req.body;
      if (!b?.scopeId || !b.name || !b.conditionValue) {
        reply.code(400);
        return fail('scopeId, name, conditionValue required');
      }
      return ok(policyAdd({ scopeId: b.scopeId, name: b.name, enabled: true, conditionType: b.conditionType ?? 'mac', conditionValue: b.conditionValue, options: b.options ?? [] }));
    },
  );
  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>('/api/dhcp/policies/:id', async (req) => {
    policyUpdate(req.params.id, req.body ?? {});
    return ok({ id: req.params.id });
  });
  app.delete<{ Params: { id: string } }>('/api/dhcp/policies/:id', async (req) => {
    policyDelete(req.params.id);
    return ok({ id: req.params.id });
  });
}
