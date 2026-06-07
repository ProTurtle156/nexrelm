/**
 * Client enrichment — turns a bare query source IP into the rich "information
 * stream" row: MAC (from the kernel neighbour table), vendor (OUI), interface,
 * and hostname (best-effort reverse DNS, async + cached).
 */
import { execFile } from 'node:child_process';
import dns from 'node:dns';
import { vendorForMac } from './presets';

interface ArpEntry {
  mac?: string;
  iface?: string;
}

let arpCache = new Map<string, ArpEntry>();
let arpAt = 0;
const ARP_TTL_MS = 8000;

function refreshArp(): void {
  execFile('ip', ['neigh', 'show'], { timeout: 2000 }, (err, stdout) => {
    if (err) return;
    const next = new Map<string, ArpEntry>();
    for (const line of stdout.split('\n')) {
      // 10.0.0.1 dev eth0 lladdr aa:bb:cc:dd:ee:ff REACHABLE
      const m = line.match(/^(\S+)\s+dev\s+(\S+).*?lladdr\s+([0-9a-f:]{17})/i);
      if (m) next.set(m[1]!, { iface: m[2], mac: m[3]!.toLowerCase() });
    }
    if (next.size) arpCache = next;
  });
}

function arpFor(ip: string): ArpEntry {
  const now = Date.now();
  if (now - arpAt > ARP_TTL_MS) {
    arpAt = now;
    refreshArp(); // async; serves the previous snapshot meanwhile
  }
  return arpCache.get(ip) ?? {};
}

// reverse-DNS hostname cache (negative-cached too)
const nameCache = new Map<string, string | null>();
const nameInflight = new Set<string>();

function resolveName(ip: string, onName: (name: string) => void): string | undefined {
  const cached = nameCache.get(ip);
  if (cached !== undefined) return cached ?? undefined;
  if (!nameInflight.has(ip)) {
    nameInflight.add(ip);
    dns.reverse(ip, (err, names) => {
      nameInflight.delete(ip);
      const name = !err && names && names.length ? names[0]! : null;
      nameCache.set(ip, name);
      if (name) onName(name);
    });
  }
  return undefined;
}

export interface ClientEnrichment {
  mac?: string;
  vendor?: string;
  iface?: string;
  name?: string;
}

/**
 * Synchronously enrich an IP from cached ARP + OUI, and (if not yet known) kick
 * off an async reverse lookup whose result is delivered via `onLateName`.
 */
export function enrichClient(ip: string, onLateName: (name: string) => void): ClientEnrichment {
  const arp = arpFor(ip);
  const name = resolveName(ip, onLateName);
  return {
    mac: arp.mac,
    iface: arp.iface,
    vendor: vendorForMac(arp.mac),
    name,
  };
}

/** Prime the ARP cache at startup. */
export function primeArp(): void {
  refreshArp();
}
