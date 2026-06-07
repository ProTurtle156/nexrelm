import type { FastifyInstance, FastifyReply } from 'fastify';
import type { WebSocket } from '@fastify/websocket';
import type { AdGroupInput, AdUserInput, ApiResponse, DirectoryConnectInput } from '@nexrelm/types';
import { directory } from '../directory/ldap';
import { withComputerIps } from '../directory/resolve';
import { openSshShell, type ShellBridge } from '../net/ssh';

function ok<T>(data: T): ApiResponse<T> {
  return { ok: true, data, error: null, meta: { generatedAt: new Date().toISOString() } };
}
function fail(error: string): ApiResponse<null> {
  return { ok: false, data: null, error };
}

/** Run a directory op; map "not connected" to 409 so the GUI re-prompts. */
async function run<T>(reply: FastifyReply, fn: () => Promise<T>): Promise<ApiResponse<T | null>> {
  try {
    return ok(await fn());
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    reply.code(/not connected|bind failed|connection/i.test(m) ? 409 : 500);
    return fail(m);
  }
}

/** Live Active Directory / Samba management surface. */
export async function registerDirectoryRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/directory/status', async () => ok(directory.status()));
  app.post<{ Body: DirectoryConnectInput }>('/api/directory/connect', async (req, reply) => {
    const b = req.body;
    if (!b?.host || !b.domain || !b.username || !b.password) {
      reply.code(400);
      return fail('mode, host, domain, username and password are required');
    }
    return run(reply, () => directory.connect({ ...b, mode: b.mode ?? 'ad', security: b.security ?? 'plain', remember: b.remember !== false }));
  });
  app.post('/api/directory/disconnect', async () => {
    await directory.disconnect(true); // forget the retained session too
    return ok(directory.status());
  });

  app.get('/api/directory/summary', async (_req, reply) => run(reply, () => directory.summary()));
  app.get('/api/directory/topology', async (_req, reply) => run(reply, () => directory.topology()));
  app.get('/api/directory/users', async (_req, reply) => run(reply, () => directory.users()));
  app.get('/api/directory/groups', async (_req, reply) => run(reply, () => directory.groups()));
  app.get('/api/directory/computers', async (_req, reply) => run(reply, async () => withComputerIps(await directory.computers())));
  app.get('/api/directory/dcs', async (_req, reply) => run(reply, () => directory.dcs()));
  app.get('/api/directory/servers', async (_req, reply) => run(reply, () => directory.servers()));

  // ── interactive SSH shell (PTY bridged over a WebSocket) ────────────────────────
  // The browser opens this socket, then sends a JSON `auth` frame; we open an SSH
  // PTY to the target and pipe raw terminal bytes both ways. By default it reuses
  // the connected DC host + admin credentials so the user is dropped straight in.
  app.get('/api/directory/shell', { websocket: true }, (socket: WebSocket) => {
    let bridge: ShellBridge | null = null;
    const send = (text: string): void => {
      if (socket.readyState === socket.OPEN) socket.send(text);
    };

    socket.on('message', (raw: Buffer) => {
      let m: { type?: string; host?: string; port?: number; username?: string; password?: string; useDirectoryPassword?: boolean; data?: string; cols?: number; rows?: number };
      try {
        m = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (m.type === 'auth' && !bridge) {
        const stored = directory.shellCreds();
        const host = (m.host || stored?.host || '').trim();
        const port = Number(m.port) || 22;
        const username = (m.username || stored?.username || '').trim();
        const password = m.useDirectoryPassword ? (stored?.password ?? '') : (m.password ?? '');
        if (!host || !username) {
          send('\r\n[nexrelm] need a host and username to open a shell.\r\n');
          return;
        }
        send(`\r\n[nexrelm] connecting to ${username}@${host}:${port} …\r\n`);
        bridge = openSshShell(
          { host, port, username, password },
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

  // ── user CRUD ────────────────────────────────────────────────────────────────
  app.post<{ Body: AdUserInput }>('/api/directory/users', async (req, reply) => {
    if (!req.body?.username) {
      reply.code(400);
      return fail('username is required');
    }
    return run(reply, async () => {
      await directory.addUser(req.body);
      return { username: req.body.username };
    });
  });
  app.patch<{ Body: { dn: string } & Partial<AdUserInput> }>('/api/directory/users', async (req, reply) => {
    const { dn, ...patch } = req.body ?? ({} as { dn: string });
    if (!dn) {
      reply.code(400);
      return fail('dn is required');
    }
    return run(reply, async () => {
      await directory.updateUser(dn, patch);
      return { dn };
    });
  });
  app.delete<{ Querystring: { dn: string } }>('/api/directory/users', async (req, reply) => {
    if (!req.query.dn) {
      reply.code(400);
      return fail('dn is required');
    }
    return run(reply, async () => {
      await directory.deleteUser(req.query.dn);
      return { dn: req.query.dn };
    });
  });
  app.post<{ Body: { dn: string; password: string } }>('/api/directory/users/password', async (req, reply) => {
    if (!req.body?.dn || !req.body.password) {
      reply.code(400);
      return fail('dn and password are required');
    }
    return run(reply, async () => {
      await directory.setPassword(req.body.dn, req.body.password);
      return { dn: req.body.dn };
    });
  });
  app.post<{ Body: { dn: string; enabled: boolean } }>('/api/directory/users/enabled', async (req, reply) =>
    run(reply, async () => {
      await directory.setEnabled(req.body.dn, req.body.enabled);
      return { dn: req.body.dn };
    }),
  );

  // ── group CRUD ───────────────────────────────────────────────────────────────
  app.post<{ Body: AdGroupInput }>('/api/directory/groups', async (req, reply) => {
    if (!req.body?.name) {
      reply.code(400);
      return fail('name is required');
    }
    return run(reply, async () => {
      await directory.addGroup(req.body);
      return { name: req.body.name };
    });
  });
  app.delete<{ Querystring: { dn: string } }>('/api/directory/groups', async (req, reply) =>
    run(reply, async () => {
      await directory.deleteGroup(req.query.dn);
      return { dn: req.query.dn };
    }),
  );
  app.post<{ Body: { groupDn: string; memberDn: string; add: boolean } }>('/api/directory/groups/member', async (req, reply) =>
    run(reply, async () => {
      await directory.setMember(req.body.groupDn, req.body.memberDn, req.body.add);
      return { groupDn: req.body.groupDn };
    }),
  );
}
