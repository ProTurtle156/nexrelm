/**
 * Automated threat intel: the heuristic layer surfaces suspicious domains/IPs
 * from the live DNS stream, and this module checks them against VirusTotal
 * automatically (rate-limited for the free tier) and caches the verdicts. Real
 * malicious hits become `malware_domain` alerts in the detection engine.
 */
import type { AutoIntelEntry, AutoIntelState, DnsQuery } from '@nexrelm/types';
import { queriesRecent } from '../dns';
import { lookupIndicator, securitySettings } from './threat';
import { monitoringActive } from './state';

const CACHE_TTL = 30 * 60 * 1000; // re-check an indicator at most every 30 min
const INTERVAL = 20_000; // ~3 lookups/min — under VT free tier (4/min)
const MAX_RECENT = 60;

const cache = new Map<string, AutoIntelEntry>();
const queue: Array<{ indicator: string; reason: string; source?: string }> = [];
let checkedCount = 0;
let started = false;
const PUBLIC_IP = /^(?!10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)\d+\.\d+\.\d+\.\d+$/;

function entropy(s: string): number {
  if (!s) return 0;
  const f = new Map<string, number>();
  for (const c of s) f.set(c, (f.get(c) ?? 0) + 1);
  let h = 0;
  for (const c of f.values()) {
    const p = c / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}
const sld = (d: string): string => {
  const p = d.replace(/\.$/, '').split('.');
  return p.length >= 2 ? p[p.length - 2]! : p[0] ?? '';
};

/** Pull fresh suspicious indicators from the recent query window into the queue. */
function enqueueSuspicious(): void {
  const recent = queriesRecent({ limit: 6000 }).filter((q) => Date.now() - new Date(q.ts).getTime() < 5 * 60 * 1000);
  const seen = new Set([...cache.keys(), ...queue.map((q) => q.indicator)]);
  const add = (indicator: string, reason: string, source?: string): void => {
    const ind = indicator.trim().toLowerCase();
    if (!ind || seen.has(ind)) return;
    const cached = cache.get(ind);
    if (cached && Date.now() - new Date(cached.checkedAt).getTime() < CACHE_TTL) return;
    seen.add(ind);
    queue.push({ indicator: ind, reason, source });
  };

  for (const q of recent) {
    if (q.status === 'nxdomain' && entropy(sld(q.domain)) > 3.5) add(q.domain, `algorithmic/NXDOMAIN lookup`, q.client);
    else if (q.status === 'blocked') add(q.domain, `blocklisted domain`, q.client);
    else if (entropy(sld(q.domain)) > 3.8 && sld(q.domain).length > 12) add(q.domain, `high-entropy domain`, q.client);
    if (q.reply && PUBLIC_IP.test(q.reply.trim())) {
      // only auto-check resolved IPs from clients that are noisy/suspicious-ish
      if (q.status === 'nxdomain' || q.status === 'blocked') add(q.reply.trim(), `IP resolved for ${q.domain}`, q.client);
    }
  }
  // keep the queue bounded
  if (queue.length > 200) queue.splice(0, queue.length - 200);
}

async function tick(): Promise<void> {
  if (!monitoringActive() || !securitySettings().virusTotalConfigured) return;
  enqueueSuspicious();
  const next = queue.shift();
  if (!next) return;
  const res = await lookupIndicator(next.indicator);
  if (res.error) return; // leave it out of the cache so it can retry later
  checkedCount++;
  cache.set(next.indicator.toLowerCase(), {
    indicator: next.indicator,
    kind: res.kind,
    verdict: res.verdict,
    malicious: res.malicious,
    suspicious: res.suspicious,
    checkedAt: new Date().toISOString(),
    reason: next.reason,
    source: next.source,
  });
}

export function startAutoIntel(): void {
  if (started) return;
  started = true;
  setInterval(() => {
    void tick();
  }, INTERVAL);
}

/** Cached entries VT flagged malicious/suspicious — used to raise alerts. */
export function maliciousIndicators(): AutoIntelEntry[] {
  return [...cache.values()].filter((e) => e.verdict === 'malicious' || e.verdict === 'suspicious');
}

export function autoIntelState(): AutoIntelState {
  const recent = [...cache.values()].sort((a, b) => b.checkedAt.localeCompare(a.checkedAt)).slice(0, MAX_RECENT);
  return { enabled: monitoringActive(), configured: securitySettings().virusTotalConfigured, checkedCount, queued: queue.length, recent };
}
