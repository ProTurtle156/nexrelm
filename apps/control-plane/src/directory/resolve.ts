/**
 * Resolve AD computers' dnsNames to IPs against the DC's own DNS server —
 * domain-joined machines register their A records there, so this is the
 * authoritative hostname→IP source for the domain (the local inventory only
 * knows hosts it has seen on the wire). Best-effort: short timeout, small
 * concurrency, 60s cache (including negative results) so the computers
 * endpoint stays fast even when many names don't resolve.
 */
import { Resolver } from 'node:dns/promises';
import type { AdComputer } from '@nexrelm/types';
import { directory } from './ldap';

const cache = new Map<string, { at: number; ip?: string }>();
const TTL_MS = 60_000;
const CONCURRENCY = 8;

export async function withComputerIps(computers: AdComputer[]): Promise<AdComputer[]> {
  const dc = directory.status().host?.split(':')[0];
  if (!dc || !computers.length) return computers;
  const resolver = new Resolver({ timeout: 1500, tries: 1 });
  resolver.setServers([dc]);
  const now = Date.now();
  const out = [...computers];
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < out.length) {
      const idx = next++;
      const c = out[idx]!;
      if (!c.dnsName) continue;
      const hit = cache.get(c.dnsName);
      if (hit && now - hit.at < TTL_MS) {
        if (hit.ip) out[idx] = { ...c, ip: hit.ip };
        continue;
      }
      try {
        const ip = (await resolver.resolve4(c.dnsName))[0];
        cache.set(c.dnsName, { at: now, ip });
        if (ip) out[idx] = { ...c, ip };
      } catch {
        cache.set(c.dnsName, { at: now, ip: undefined }); // negative-cache misses too
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, out.length) }, worker));
  return out;
}
