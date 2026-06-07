/**
 * ARP-table monitor — detects ARP spoofing / cache poisoning by watching the
 * kernel neighbour table (`ip neigh`, non-root) over time. When an IP's MAC
 * changes out from under it, that's the signature of a man-in-the-middle
 * reassigning its L2 identity. This works WITHOUT the passive sniffer or any
 * capability: if an attacker poisons the gateway (or any host this machine
 * talks to), the kernel's ARP cache flips and we catch it. Complements the
 * sniffer-based ARP detection, which only sees broadcast/visible ARP.
 */
import { execFile } from 'node:child_process';
import type { SecurityAlert } from '@nexrelm/types';

const seen = new Map<string, string>(); // ip -> last known mac
const flips = new Map<string, { from: string; to: string; ts: number; count: number }>();
const FLIP_TTL = 5 * 60_000;

/** Snapshot `ip neigh` and record any MAC that changed for an IP. Call periodically. */
export function sampleArpTable(): Promise<void> {
  return new Promise((resolve) => {
    execFile('ip', ['neigh', 'show'], { timeout: 3000 }, (_e, out) => {
      for (const line of (out || '').split('\n')) {
        const m = line.match(/^(\d+\.\d+\.\d+\.\d+)\s+dev\s+\S+\s+lladdr\s+([0-9a-f:]{17})\s+(\w+)/i);
        if (!m) continue;
        const ip = m[1]!;
        const mac = m[2]!.toLowerCase();
        const state = m[3]!.toUpperCase();
        if (state === 'FAILED' || state === 'INCOMPLETE') continue;
        const prev = seen.get(ip);
        if (prev && prev !== mac) {
          const existing = flips.get(ip);
          flips.set(ip, { from: existing?.from ?? prev, to: mac, ts: Date.now(), count: (existing?.count ?? 0) + 1 });
        }
        seen.set(ip, mac);
      }
      resolve();
    });
  });
}

/** Active ARP-spoof alerts from observed MAC flips (sync; read by detectThreats). */
export function arpFlipAlerts(): SecurityAlert[] {
  const now = Date.now();
  const out: SecurityAlert[] = [];
  for (const [ip, f] of flips) {
    if (now - f.ts > FLIP_TTL) {
      flips.delete(ip);
      continue;
    }
    const gatewayish = /\.(1|254)$/.test(ip);
    out.push({
      id: `arp_spoof:flip:${ip}`,
      ts: new Date(f.ts).toISOString(),
      severity: gatewayish ? 'critical' : 'high',
      kind: 'arp_spoof',
      source: ip,
      title: gatewayish ? 'Gateway ARP spoofing (MAC changed)' : 'ARP spoofing — MAC address changed',
      detail: `${ip} changed MAC from ${f.from} to ${f.to}${f.count > 1 ? ` (${f.count} flips)` : ''} — its L2 identity was reassigned out from under it, the signature of ARP cache poisoning / a man-in-the-middle.`,
      count: f.count,
      evidence: `${f.from} → ${f.to}`,
      mitre: { id: 'T1557.002', name: 'ARP Cache Poisoning' },
    });
  }
  return out;
}
