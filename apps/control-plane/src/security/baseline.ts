/**
 * Adaptive anomaly baselining — learns each device's normal behaviour online
 * (Welford mean/variance) for a few DNS metrics, persisted in SQLite so it
 * survives restarts and keeps maturing. Detection compares the current window
 * against the learned baseline and flags deviations beyond K·σ once enough
 * samples exist. Learning is decoupled from detection: a slow sampler updates
 * the baseline; detectThreats reads it.
 */
import type { BaselineState, DeviceBaseline } from '@nexrelm/types';
import { db } from './store';
import { queriesRecent } from '../dns';
import { monitoringActive } from './state';

const METRICS = ['qps', 'unique_domains', 'nxdomain'] as const;
const MIN_SAMPLES = 15; // don't flag until we've learned a device's normal
const K = 3; // σ multiplier for "anomalous"

function stddev(m2: number, n: number): number {
  return n > 1 ? Math.sqrt(m2 / (n - 1)) : 0;
}

/** Welford online update of mean/variance for one (client, metric). */
function observe(client: string, metric: string, value: number): void {
  const row = db.prepare('SELECT mean, m2, n FROM baseline WHERE client = ? AND metric = ?').get(client, metric);
  let mean = row ? Number(row.mean) : 0;
  let m2 = row ? Number(row.m2) : 0;
  let n = row ? Number(row.n) : 0;
  n += 1;
  const delta = value - mean;
  mean += delta / n;
  m2 += delta * (value - mean);
  db.prepare('INSERT INTO baseline(client,metric,mean,m2,n,updated) VALUES(?,?,?,?,?,?) ON CONFLICT(client,metric) DO UPDATE SET mean=excluded.mean, m2=excluded.m2, n=excluded.n, updated=excluded.updated').run(
    client,
    metric,
    mean,
    m2,
    n,
    new Date().toISOString(),
  );
}

/** Snapshot each client's metrics over the window and fold them into the baseline. */
export function learnFromWindow(windowSec = 60): void {
  if (!monitoringActive()) return;
  const cutoff = Date.now() - windowSec * 1000;
  const recent = queriesRecent({ limit: 12_000 }).filter((r) => new Date(r.ts).getTime() >= cutoff);
  const byClient = new Map<string, typeof recent>();
  for (const r of recent) (byClient.get(r.client) ?? byClient.set(r.client, []).get(r.client)!).push(r);
  for (const [client, qs] of byClient) {
    observe(client, 'qps', qs.length / windowSec);
    observe(client, 'unique_domains', new Set(qs.map((q) => q.domain.toLowerCase())).size);
    observe(client, 'nxdomain', qs.filter((q) => q.status === 'nxdomain').length);
  }
}

/** Compare a client's current metrics to its learned baseline. */
export function baselineFor(client: string, current: Record<string, number>): DeviceBaseline {
  const metrics = METRICS.map((metric) => {
    const row = db.prepare('SELECT mean, m2, n FROM baseline WHERE client = ? AND metric = ?').get(client, metric);
    const mean = row ? Number(row.mean) : 0;
    const n = row ? Number(row.n) : 0;
    const std = stddev(row ? Number(row.m2) : 0, n);
    const cur = current[metric] ?? 0;
    const deviation = std > 0 ? (cur - mean) / std : 0;
    return { metric, mean, std, current: cur, deviation, samples: n };
  });
  const anomalous = metrics.some((m) => m.samples >= MIN_SAMPLES && m.deviation >= K && m.current > m.mean);
  return { client, metrics, anomalous };
}

export function baselineState(): BaselineState {
  const clients = db.prepare('SELECT DISTINCT client FROM baseline').all().map((r) => String(r.client));
  const devices = clients.map((c) => baselineFor(c, {}));
  const sampleCount = Number(db.prepare('SELECT COALESCE(MAX(n),0) AS m FROM baseline').get()?.m ?? 0);
  return { learning: monitoringActive(), devices, sampleCount };
}
