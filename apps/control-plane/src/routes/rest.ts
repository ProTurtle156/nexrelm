import type { FastifyInstance } from 'fastify';
import type { ApiResponse, VmState } from '@nexrelm/types';
import { world } from '../core/world';
import { buildTopology } from '../core/topology';

function ok<T>(data: T): ApiResponse<T> {
  return { ok: true, data, error: null, meta: { generatedAt: new Date().toISOString() } };
}
function fail(error: string): ApiResponse<null> {
  return { ok: false, data: null, error };
}

const VM_ACTIONS: Record<string, VmState> = {
  start: 'running',
  stop: 'stopped',
  pause: 'paused',
  resume: 'running',
};

/** Read + command surface for every module. */
export async function registerRest(app: FastifyInstance): Promise<void> {
  app.get('/api/health', async () =>
    ok({ status: 'operational', service: 'nexrelm-control-plane', version: '0.1.0', uptimeSec: Math.round(process.uptime()) }),
  );

  app.get('/api/dashboard', async () => ok(world.getDashboard()));
  app.get('/api/modules', async () => ok(world.getModules()));
  app.get('/api/topology', async () => ok(await buildTopology()));
  app.get('/api/dns', async () => ok(world.getDns()));
  app.get('/api/dhcp', async () => ok(world.getDhcp()));
  app.get('/api/directory', async () => ok(world.getDirectory()));
  app.get('/api/virtualization', async () => ok(world.getVirt()));
  app.get('/api/security', async () => ok(world.getSecurity()));

  // ── command endpoints — make the GUI controls real ──────────────────────
  app.post<{ Params: { id: string; action: string } }>(
    '/api/virtualization/vms/:id/:action',
    async (req, reply) => {
      const { id, action } = req.params;
      const next = VM_ACTIONS[action];
      if (!next) {
        reply.code(400);
        return fail(`unknown vm action: ${action}`);
      }
      if (!world.setVmState(id, next)) {
        reply.code(404);
        return fail(`vm not found: ${id}`);
      }
      return ok({ id, state: next });
    },
  );

  app.post<{ Params: { id: string } }>('/api/security/rules/:id/toggle', async (req, reply) => {
    const { id } = req.params;
    if (!world.toggleFirewallRule(id)) {
      reply.code(404);
      return fail(`rule not found: ${id}`);
    }
    return ok({ id });
  });
}
