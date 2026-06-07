import type { FastifyInstance } from 'fastify';
import type { WebSocket } from '@fastify/websocket';
import { world } from '../core/world';
import { onLog } from '../core/logbus';

/**
 * /ws — the live event channel. Every connected client receives the same
 * stream of incremental LiveEvent deltas (metrics, logs, alerts, topology
 * updates, leases). Initial state is fetched over REST; this is deltas only.
 */
export async function registerWs(app: FastifyInstance): Promise<void> {
  app.get('/ws', { websocket: true }, (socket: WebSocket) => {
    const unsubscribe = world.subscribe((event) => {
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify(event));
      }
    });
    // real, unified log stream from every module
    const unsubLog = onLog((line) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({ kind: 'log', line }));
    });
    const cleanup = (): void => {
      unsubscribe();
      unsubLog();
    };

    socket.on('close', cleanup);
    socket.on('error', cleanup);

    socket.send(
      JSON.stringify({
        kind: 'log',
        line: {
          id: 'connect',
          ts: new Date().toISOString(),
          stream: 'system',
          level: 'info',
          msg: 'nexrelm live stream connected',
        },
      }),
    );
  });
}
