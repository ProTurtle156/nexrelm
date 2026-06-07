/**
 * Security analytics derived from the live DNS resolver query stream — the real
 * data Nexrelm already has. Powers the posture dashboard: client OS breakdown,
 * QPS, response-status mix, top sources/destinations, access vs block.
 */
import type { ClientOs, QueryStatus, SecClientGroup, SecTopEntry, SecurityDevice, SecurityOverview, SecuritySeriesPoint } from '@nexrelm/types';
import { queriesRecent } from '../dns';
import { snifferActive, sniffTalkers, sniffFlows, sniffRateBuckets, sniffPacketsInWindow } from './sniffer';

const ACCESS: QueryStatus[] = ['forwarded', 'cached', 'allowed', 'local'];
const BLOCK: QueryStatus[] = ['blocked', 'refused'];
const NON_IP_REPLY = /^(0\.0\.0\.0|::|nxdomain|servfail|refused)?$/i;

/** Best-effort OS / device class from hostname + MAC OUI vendor. */
export function classifyOs(c: { name?: string; nickname?: string; vendor?: string; osHint?: string }): ClientOs {
  // nmap OS fingerprint is the strongest signal — trust it first
  const o = (c.osHint || '').toLowerCase();
  if (o) {
    if (/windows/.test(o)) return 'windows';
    if (/mac ?os|os x|darwin/.test(o)) return 'macos';
    if (/iphone|ipad|\bios\b/.test(o)) return 'ios';
    if (/android/.test(o)) return 'android';
    if (/linux|ubuntu|debian|fedora|cent\s?os|red ?hat|alpine|bsd/.test(o)) return 'linux';
    if (/router|switch|printer|embedded|webcam|camera|vxworks|iot|jetdirect/.test(o)) return 'network';
  }
  const h = (c.nickname || c.name || '').toLowerCase();
  const v = (c.vendor || '').toLowerCase();
  if (/iphone|ipad|\bios\b/.test(h)) return 'ios';
  if (/android|galaxy|pixel|oneplus|redmi|xiaomi|huawei|oppo|vivo/.test(h)) return 'android';
  if (/macbook|imac|mac-?mini|macos|osx/.test(h)) return 'macos';
  if (/desktop-|windows|win-?pc|\blaptop\b/.test(h)) return 'windows';
  if (/ubuntu|fedora|debian|arch|linux|raspberr|pi-?hole|nixos/.test(h)) return 'linux';
  if (/apple/.test(v)) return /phone|pad/.test(h) ? 'ios' : 'macos';
  if (/samsung|google|xiaomi|huawei|oneplus|oppo|vivo|motorola/.test(v)) return 'android';
  if (/microsoft/.test(v)) return 'windows';
  if (/cisco|ubiquiti|tp-?link|netgear|d-?link|mikrotik|aruba|juniper|fortinet|hewlett|routerboard|espressif|tuya|sonos|amazon|ring|nest/.test(v)) return 'network';
  return 'other';
}

function topN(counts: Map<string, number>, n: number, label?: Map<string, string>): SecTopEntry[] {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([key, count]) => ({ key, count, label: label?.get(key) }));
}

export function computeOverview(windowSec: number, extra: { postureScore: number; activeAlerts: number }, devices: SecurityDevice[]): SecurityOverview {
  const now = Date.now();
  const cutoff = now - windowSec * 1000;
  const recent = queriesRecent({ limit: 10_000 }).filter((r) => new Date(r.ts).getTime() >= cutoff);

  let access = 0;
  let blocked = 0;
  const byStatus = new Map<QueryStatus, number>();
  const sources = new Map<string, number>();
  const dests = new Map<string, number>();
  const sourceName = new Map<string, string>();

  for (const r of recent) {
    byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1);
    if (ACCESS.includes(r.status)) access++;
    else if (BLOCK.includes(r.status)) blocked++;
    sources.set(r.client, (sources.get(r.client) ?? 0) + 1);
    if (r.clientName) sourceName.set(r.client, r.clientName);
    if (r.reply && !NON_IP_REPLY.test(r.reply.trim())) dests.set(r.reply.trim(), (dests.get(r.reply.trim()) ?? 0) + 1);
  }

  // merge passive-sniffer traffic into sources/destinations when capturing
  if (snifferActive()) {
    for (const t of sniffTalkers()) sources.set(t.ip, (sources.get(t.ip) ?? 0) + t.packets);
    for (const f of sniffFlows()) dests.set(f.dst, (dests.get(f.dst) ?? 0) + f.packets);
  }

  // platform breakdown across ALL internal clients on the subnet
  // (ARP/neighbour table + DNS + passive sniffer + scans), not just DNS users.
  const osMap = new Map<ClientOs, SecClientGroup>();
  for (const d of devices) {
    const g = osMap.get(d.os) ?? { os: d.os, count: 0, queries: 0 };
    g.count++;
    g.queries += d.queries;
    osMap.set(d.os, g);
  }

  // traffic series (≈40 buckets across the window): DNS queries + captured packets
  const buckets = 40;
  const span = Math.max(1, windowSec) * 1000;
  const size = span / buckets;
  const series: SecuritySeriesPoint[] = Array.from({ length: buckets }, (_, i) => ({ t: cutoff + i * size, total: 0, blocked: 0 }));
  for (const r of recent) {
    const idx = Math.min(buckets - 1, Math.max(0, Math.floor((new Date(r.ts).getTime() - cutoff) / size)));
    series[idx]!.total++;
    if (BLOCK.includes(r.status)) series[idx]!.blocked++;
  }
  // blend the live packet rate from the sniffer so the graph reflects ALL traffic,
  // not just DNS — otherwise it sits flat whenever clients don't resolve through us.
  let wireTotal = 0;
  if (snifferActive()) {
    const pkts = sniffRateBuckets(cutoff, size, buckets);
    for (let i = 0; i < buckets; i++) series[i]!.total += pkts[i]!;
    wireTotal = sniffPacketsInWindow(windowSec);
  }

  const dnsTotal = recent.length;
  const total = dnsTotal + wireTotal; // total observed events for the headline + graph
  return {
    generatedAt: new Date(now).toISOString(),
    windowSec,
    qps: Math.round((total / Math.max(1, windowSec)) * 10) / 10,
    totalQueries: total,
    access,
    blocked,
    blockRate: dnsTotal ? blocked / dnsTotal : 0,
    uniqueClients: devices.length || sources.size,
    clientsByOs: [...osMap.values()].sort((a, b) => b.queries - a.queries),
    statusBreakdown: [...byStatus.entries()].map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count),
    topSources: topN(sources, 10, sourceName),
    topDestinations: topN(dests, 10),
    series,
    postureScore: extra.postureScore,
    activeAlerts: extra.activeAlerts,
  };
}
