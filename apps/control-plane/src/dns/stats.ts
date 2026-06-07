/** Aggregate the query log (last 24h) into the dashboard statistics. */
import type { DnsResolverStats } from '@nexrelm/types';
import { db } from './db';
import { blockDomainCount } from './lists';

const BUCKET_SEC = 1800; // 30-minute buckets
const BUCKETS = 48; // a full 24h of 30-minute buckets

export function computeStats(): DnsResolverStats {
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const n = (v: unknown): number => Number(v ?? 0);

  const byStatus = db.prepare('SELECT status, COUNT(*) AS c FROM queries WHERE ts > ? GROUP BY status').all(since);
  let total = 0;
  let blocked = 0;
  let cached = 0;
  let forwarded = 0;
  for (const r of byStatus) {
    const c = n(r.c);
    total += c;
    const s = String(r.status);
    if (s === 'blocked') blocked += c;
    else if (s === 'cached') cached += c;
    else if (s === 'forwarded' || s === 'allowed') forwarded += c;
  }

  const uniq = db.prepare('SELECT COUNT(DISTINCT client) AS clients, COUNT(DISTINCT domain) AS domains FROM queries WHERE ts > ?').get(since);
  const avg = db.prepare("SELECT AVG(reply_ms) AS a FROM queries WHERE ts > ? AND status IN ('forwarded','allowed')").get(since);

  // BUCKET_SEC is inlined, not bound: node:sqlite binds JS numbers as REAL, and
  // integer/REAL is real division — every distinct second became its own "bucket".
  // An integer literal keeps SQLite's integer division, so rows group on aligned
  // 30-minute boundaries. The window starts on a bucket boundary and is zero-filled
  // below so the chart always gets BUCKETS uniformly-spaced points.
  const nowBucket = Math.floor(Date.now() / 1000 / BUCKET_SEC);
  const firstBucket = nowBucket - (BUCKETS - 1);
  const seriesSince = new Date(firstBucket * BUCKET_SEC * 1000).toISOString();
  const seriesRows = db
    .prepare(
      `SELECT (CAST(strftime('%s', ts) AS INTEGER) / ${BUCKET_SEC}) AS bucket,
              COUNT(*) AS total,
              SUM(CASE WHEN status = 'blocked' THEN 1 ELSE 0 END) AS blocked
       FROM queries WHERE ts >= ? GROUP BY bucket ORDER BY bucket`,
    )
    .all(seriesSince);
  const byBucket = new Map(seriesRows.map((r) => [n(r.bucket), r]));
  const series = Array.from({ length: BUCKETS }, (_, i) => {
    const b = firstBucket + i;
    const r = byBucket.get(b);
    return { t: b * BUCKET_SEC * 1000, total: n(r?.total), blocked: n(r?.blocked) };
  });

  const topBlocked = db
    .prepare("SELECT domain, COUNT(*) AS c FROM queries WHERE ts > ? AND status = 'blocked' GROUP BY domain ORDER BY c DESC LIMIT 10")
    .all(since);
  const topAllowed = db
    .prepare("SELECT domain, COUNT(*) AS c FROM queries WHERE ts > ? AND status IN ('forwarded','cached','allowed') GROUP BY domain ORDER BY c DESC LIMIT 10")
    .all(since);
  const topClients = db
    .prepare('SELECT client, client_name, COUNT(*) AS c FROM queries WHERE ts > ? GROUP BY client ORDER BY c DESC LIMIT 10')
    .all(since);
  const topClientsBlocked = db
    .prepare("SELECT client, client_name, COUNT(*) AS c FROM queries WHERE ts > ? AND status = 'blocked' GROUP BY client ORDER BY c DESC LIMIT 10")
    .all(since);
  const queryTypes = db.prepare('SELECT type, COUNT(*) AS c FROM queries WHERE ts > ? GROUP BY type ORDER BY c DESC').all(since);
  const upstreamsUsed = db
    .prepare('SELECT upstream, COUNT(*) AS c FROM queries WHERE ts > ? AND upstream IS NOT NULL GROUP BY upstream ORDER BY c DESC')
    .all(since);

  return {
    totalQueries: total,
    blocked,
    blockedPct: total ? Math.round((blocked / total) * 1000) / 10 : 0,
    cached,
    forwarded,
    uniqueClients: n(uniq?.clients),
    uniqueDomains: n(uniq?.domains),
    domainsOnLists: blockDomainCount(),
    activeClients: n(uniq?.clients),
    series,
    topAllowed: topAllowed.map((r) => ({ domain: String(r.domain), count: n(r.c) })),
    topBlocked: topBlocked.map((r) => ({ domain: String(r.domain), count: n(r.c) })),
    topClients: topClients.map((r) => ({ client: String(r.client), name: (r.client_name as string) ?? undefined, count: n(r.c) })),
    topClientsByBlocked: topClientsBlocked.map((r) => ({ client: String(r.client), name: (r.client_name as string) ?? undefined, count: n(r.c) })),
    queryTypes: queryTypes.map((r) => ({ type: String(r.type), count: n(r.c) })),
    upstreamsUsed: upstreamsUsed.map((r) => ({ upstream: String(r.upstream), count: n(r.c) })),
    replyTimeMs: Math.round(n(avg?.a) * 10) / 10,
  };
}
