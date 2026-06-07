import type { FastifyInstance, FastifyReply } from 'fastify';
import type { WebSocket } from '@fastify/websocket';
import type { ApiResponse, VmMachineInput } from '@nexrelm/types';
import { vmStore } from '../vms/store';
import { collectStats } from '../vms/collect';
import { openSshShell, type ShellBridge } from '../net/ssh';
import { pushLog } from '../core/logbus';

function ok<T>(data: T): ApiResponse<T> {
  return { ok: true, data, error: null, meta: { generatedAt: new Date().toISOString() } };
}
function fail(error: string): ApiResponse<null> {
  return { ok: false, data: null, error };
}

/** Refresh one VM's telemetry and persist it; returns the updated public record. */
async function refresh(id: string) {
  const target = vmStore.target(id);
  if (!target) return vmStore.getPublic(id);
  const stats = await collectStats(target);
  return vmStore.setStats(id, stats) ?? vmStore.getPublic(id);
}

/** Real SSH-backed VM management: registry, live telemetry, and a terminal. */
export async function registerVmRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/vms', async () => ok(vmStore.list()));

  app.get<{ Params: { id: string } }>('/api/vms/:id', async (req, reply) => {
    const v = vmStore.getPublic(req.params.id);
    if (!v) {
      reply.code(404);
      return fail('no such VM');
    }
    return ok(v);
  });

  app.post<{ Body: VmMachineInput }>('/api/vms', async (req, reply) => {
    const b = req.body;
    if (!b?.name || !b.host || !b.username) {
      reply.code(400);
      return fail('name, host and username are required');
    }
    const created = vmStore.add(b);
    pushLog('virt', 'info', `VM registered: ${created.name} (${b.username}@${b.host})`);
    const refreshed = await refresh(created.id); // first telemetry on add
    return ok(refreshed ?? created);
  });

  app.patch<{ Params: { id: string }; Body: Partial<VmMachineInput> }>('/api/vms/:id', async (req, reply) => {
    const updated = vmStore.update(req.params.id, req.body ?? {});
    if (!updated) {
      reply.code(404);
      return fail('no such VM');
    }
    return ok(updated);
  });

  app.delete<{ Params: { id: string } }>('/api/vms/:id', async (req, reply) => {
    if (!vmStore.remove(req.params.id)) {
      reply.code(404);
      return fail('no such VM');
    }
    return ok({ id: req.params.id });
  });

  app.post<{ Params: { id: string } }>('/api/vms/:id/refresh', async (req, reply) => {
    const v = vmStore.getPublic(req.params.id);
    if (!v) {
      reply.code(404);
      return fail('no such VM');
    }
    return ok(await refresh(req.params.id));
  });

  // refresh every VM's telemetry (used by the Overview dashboard)
  app.post('/api/vms/refresh', async () => {
    const ids = vmStore.list().map((v) => v.id);
    const results = await Promise.all(ids.map((id) => refresh(id)));
    return ok(results.filter(Boolean));
  });

  // ── interactive terminal into a VM (PTY over WebSocket, saved creds) ────────────
  app.get('/api/vms/shell', { websocket: true }, (socket: WebSocket) => {
    let bridge: ShellBridge | null = null;
    const send = (text: string): void => {
      if (socket.readyState === socket.OPEN) socket.send(text);
    };
    socket.on('message', (raw: Buffer) => {
      let m: { type?: string; id?: string; data?: string; cols?: number; rows?: number };
      try {
        m = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (m.type === 'auth' && !bridge) {
        const target = m.id ? vmStore.target(m.id) : null;
        if (!target) {
          send('\r\n[nexrelm] unknown VM or no saved credentials.\r\n');
          if (socket.readyState === socket.OPEN) socket.close();
          return;
        }
        send(`\r\n[nexrelm] connecting to ${target.username}@${target.host}:${target.port} …\r\n`);
        pushLog('virt', 'info', `SSH session opened to ${target.username}@${target.host}`);
        bridge = openSshShell(
          target,
          send,
          (reason) => {
            if (reason) send(`\r\n[nexrelm] session closed: ${reason}\r\n`);
            if (socket.readyState === socket.OPEN) socket.close();
          },
          m.cols,
          m.rows,
        );
      } else if (m.type === 'data' && bridge && typeof m.data === 'string') {
        bridge.write(m.data);
      } else if (m.type === 'resize' && bridge) {
        bridge.resize(Number(m.cols) || 80, Number(m.rows) || 24);
      }
    });
    socket.on('close', () => bridge?.end());
    socket.on('error', () => bridge?.end());
  });
}
