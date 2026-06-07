/**
 * DNS subsystem entry — boot/compile/control surface used by the REST routes
 * and the server bootstrap. Owns gravity (adlist) fetching + list compilation
 * and the resolver lifecycle.
 */
import type { BlockingState, DnsResolverSettings, DnsResolverStatus } from '@nexrelm/types';
import { adlistsAll, db, getSettings, gravityReplace, gravityTotal, saveSettings, getBlocking, setBlocking, pruneByAge } from './db';
import { compile } from './lists';
import { resolver } from './resolver';
import { primeArp } from './clients';

export * from './db';
export * from './sinkhole';
export { computeStats } from './stats';
export { UPSTREAM_PRESETS } from './presets';
export { resolver };

/** Parse a hosts-format or plain-domain blocklist into clean domains. */
function parseBlocklist(text: string): string[] {
  const out = new Set<string>();
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('!')) continue;
    const parts = line.split(/\s+/);
    const candidate = (parts.length >= 2 ? parts[1] : parts[0])!.toLowerCase().replace(/\.$/, '');
    if (!candidate || candidate === 'localhost' || candidate.includes('/')) continue;
    if (!/^([a-z0-9_-]+\.)+[a-z]{2,}$/i.test(candidate)) continue;
    out.add(candidate);
  }
  return [...out];
}

export interface GravityResult {
  ok: number;
  failed: number;
  total: number;
  lists: Array<{ url: string; count: number; ok: boolean; error?: string }>;
}

/** Re-fetch every enabled HTTP adlist and recompile the lookup tables. */
export async function rebuildGravity(): Promise<GravityResult> {
  const lists = adlistsAll().filter((a) => a.enabled && /^https?:\/\//i.test(a.url));
  const results: GravityResult['lists'] = [];
  for (const a of lists) {
    db.prepare("UPDATE adlists SET status = 'downloading' WHERE id = ?").run(a.id);
    try {
      const res = await fetch(a.url, { signal: AbortSignal.timeout(25_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const domains = parseBlocklist(await res.text());
      gravityReplace(a.id, domains);
      results.push({ url: a.url, count: domains.length, ok: true });
    } catch (e) {
      db.prepare("UPDATE adlists SET status = 'error' WHERE id = ?").run(a.id);
      results.push({ url: a.url, count: 0, ok: false, error: e instanceof Error ? e.message : 'failed' });
    }
  }
  recompile();
  return {
    ok: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    total: gravityTotal(),
    lists: results,
  };
}

/** Rebuild the in-memory block/allow lookup from the DB. Call after any change. */
export function recompile(): void {
  compile();
}

/** Boot the resolver: compile lists, prime ARP, bind sockets. */
export async function startDns(): Promise<DnsResolverStatus> {
  const s = getSettings();
  pruneByAge(s.dbMaxDays, s.ipMaxDays);
  compile();
  primeArp();
  return resolver.start(s);
}

/** Pause/resume blocking, optionally for a fixed number of seconds. */
export function setBlockingState(action: 'enable' | 'disable', seconds?: number): BlockingState {
  const state: BlockingState =
    action === 'enable'
      ? { enabled: true, disabledUntil: null }
      : { enabled: false, disabledUntil: seconds && seconds > 0 ? new Date(Date.now() + seconds * 1000).toISOString() : null };
  setBlocking(state);
  resolver.setBlocking(state);
  return state;
}

export function blockingState(): BlockingState {
  return getBlocking();
}

/** Persist a settings patch and restart the resolver if the binding changed. */
export async function applyDnsSettings(patch: Partial<DnsResolverSettings>): Promise<DnsResolverStatus> {
  const before = getSettings();
  const after = saveSettings(patch);
  pruneByAge(after.dbMaxDays, after.ipMaxDays);
  const rebind =
    before.bindAddress !== after.bindAddress ||
    before.port !== after.port ||
    JSON.stringify(before.upstreams) !== JSON.stringify(after.upstreams);
  if (rebind) return resolver.start(after);
  resolver.configure(after);
  return resolver.status();
}

export function dnsStatus(): DnsResolverStatus {
  return resolver.status();
}
