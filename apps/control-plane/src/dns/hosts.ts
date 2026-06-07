/**
 * Local name resolution from /etc/hosts (and the configured local domain).
 * Lets the resolver answer LAN hostnames itself instead of forwarding them.
 * Refreshed on a short interval; never throws.
 */
import fs from 'node:fs';

let nameToIps = new Map<string, string[]>();
let ipToName = new Map<string, string>();
let loadedAt = 0;
const TTL_MS = 30_000;

function load(): void {
  try {
    const txt = fs.readFileSync('/etc/hosts', 'utf8');
    const n2i = new Map<string, string[]>();
    const i2n = new Map<string, string>();
    for (const raw of txt.split('\n')) {
      const line = raw.replace(/#.*/, '').trim();
      if (!line) continue;
      const [ip, ...names] = line.split(/\s+/);
      if (!ip) continue;
      for (const name of names) {
        const key = name.toLowerCase();
        (n2i.get(key) ?? n2i.set(key, []).get(key)!).push(ip);
        if (!i2n.has(ip)) i2n.set(ip, name);
      }
    }
    nameToIps = n2i;
    ipToName = i2n;
  } catch {
    /* keep the previous snapshot */
  }
}

function fresh(): void {
  const now = Date.now();
  if (now - loadedAt > TTL_MS) {
    loadedAt = now;
    load();
  }
}

function reverseIp(name: string): string | null {
  const m = name.toLowerCase().match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)\.in-addr\.arpa\.?$/);
  return m ? `${m[4]}.${m[3]}.${m[2]}.${m[1]}` : null;
}

export interface LocalAnswer {
  type: 'A' | 'AAAA' | 'PTR';
  value: string;
}

/** A local answer for `name`/`type`, or null to forward. */
export function localAnswer(name: string, type: string): LocalAnswer | null {
  fresh();
  const n = name.toLowerCase().replace(/\.$/, '');
  if (type === 'A' || type === 'AAAA') {
    const ips = (nameToIps.get(n) ?? []).filter((ip) => (type === 'A' ? ip.includes('.') && !ip.includes(':') : ip.includes(':')));
    // never serve loopback for LAN names
    const usable = ips.filter((ip) => ip !== '127.0.0.1' && ip !== '::1');
    if (usable.length) return { type, value: usable[0]! };
  }
  if (type === 'PTR') {
    const ip = reverseIp(n);
    if (ip) {
      const host = ipToName.get(ip);
      if (host && host !== 'localhost') return { type: 'PTR', value: host };
    }
  }
  return null;
}
