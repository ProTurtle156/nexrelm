/**
 * Central log bus — the real, unified activity stream for ALL of Nexrelm. Every
 * module (dns, dhcp, directory, virt, security, system) writes real events here
 * via pushLog(); the WS forwards new lines live and /api/logs serves the recent
 * buffer. This replaced the old simulated makeLog() generator in the world.
 */
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { LogLevel, LogLine, LogStream } from '@nexrelm/types';

const bus = new EventEmitter();
bus.setMaxListeners(0);
const ring: LogLine[] = [];
let capacity = 2000; // operator-tunable via system settings

/** Resize the ring buffer (system settings), trimming oldest lines if needed. */
export function setLogCapacity(lines: number): void {
  const n = Math.floor(Number(lines));
  capacity = Number.isFinite(n) ? Math.min(20000, Math.max(200, n)) : 2000;
  if (ring.length > capacity) ring.splice(0, ring.length - capacity);
}

export function pushLog(stream: LogStream, level: LogLevel, msg: string): void {
  const line: LogLine = { id: randomUUID(), ts: new Date().toISOString(), stream, level, msg };
  ring.push(line);
  if (ring.length > capacity) ring.splice(0, ring.length - capacity);
  bus.emit('log', line);
}

export function recentLogs(opts: { limit?: number; stream?: string; level?: string } = {}): LogLine[] {
  let rows = ring;
  if (opts.stream && opts.stream !== 'all') rows = rows.filter((l) => l.stream === opts.stream);
  if (opts.level && opts.level !== 'all') rows = rows.filter((l) => l.level === opts.level);
  const limit = Math.min(capacity, Math.max(1, opts.limit ?? 500));
  return rows.slice(-limit).reverse(); // newest first
}

export function onLog(cb: (line: LogLine) => void): () => void {
  bus.on('log', cb);
  return () => bus.off('log', cb);
}
