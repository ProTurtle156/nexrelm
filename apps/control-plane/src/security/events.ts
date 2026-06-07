/**
 * Security event feed — the live stream the dashboard shows. NOT raw DNS: it's
 * a rolling, time-ordered log of heuristic threat detections (info → critical),
 * each emitted once per cooldown so the feed reads like a SIEM alert stream.
 */
import { randomUUID } from 'node:crypto';
import type { SecurityAlert } from '@nexrelm/types';
import { detectThreats } from './heuristics';
import { monitoringActive } from './state';
import { maybeRespond } from './response';
import { recordThreat } from './remediation';
import { inventory } from './inventory';
import { syncDevices, newDeviceAlert } from './registry';
import { learnFromWindow } from './baseline';
import { badDomains } from './intel-feeds';
import { sampleArpTable } from './arp-monitor';
import { sinkholeState, setSinkholeDomains } from '../dns';
import { pushLog } from '../core/logbus';

const SEV_LEVEL = { critical: 'error', high: 'warn', medium: 'warn', low: 'info', info: 'info' } as const;

const ring: SecurityAlert[] = [];
const lastEmit = new Map<string, number>();
let started = false;

export function recentEvents(limit = 120): SecurityAlert[] {
  return ring.slice(-limit).reverse();
}

function push(ev: SecurityAlert): void {
  ring.push(ev);
  if (ring.length > 600) ring.splice(0, ring.length - 600);
}

export function startEventRunner(): void {
  if (started) return;
  started = true;
  setInterval(() => {
    if (!monitoringActive()) return;
    for (const a of detectThreats(120)) {
      const key = `${a.kind}:${a.source}`;
      if (Date.now() - (lastEmit.get(key) ?? 0) < 30_000) continue; // cooldown to avoid spam
      lastEmit.set(key, Date.now());
      const response = maybeRespond(a); // active-response: auto-block if policy allows
      recordThreat(a); // persist into the remediation tab until applied/dismissed
      push({ ...a, id: randomUUID(), ts: new Date().toISOString(), response });
      pushLog('security', SEV_LEVEL[a.severity], `${a.title} — ${a.source}${response ? ` (${response})` : ''}`);
    }
  }, 5000);

  // watch the kernel ARP table for MAC flips (spoofing) — no sniffer needed
  void sampleArpTable();
  setInterval(() => void sampleArpTable(), 15_000);
  // device registry sync + new-device alerts
  setInterval(() => void syncDevicesTick(), 30_000);
  // learn per-device behavioural baselines
  setInterval(() => learnFromWindow(60), 60_000);
  // reload the DNS sinkhole set from refreshed threat-intel feeds
  setInterval(() => reloadSinkhole(), 600_000);
}

async function syncDevicesTick(): Promise<void> {
  if (!monitoringActive()) return;
  try {
    const devs = await inventory();
    const newly = syncDevices(devs.map((d) => ({ mac: d.mac, ip: d.ip, vendor: d.vendor, os: d.os })));
    for (const d of newly) {
      const a = newDeviceAlert(d);
      recordThreat(a);
      push(a);
      pushLog('security', 'warn', `new device joined: ${d.ip} [${d.mac}]${d.vendor ? ` ${d.vendor}` : ''}`);
    }
  } catch {
    /* inventory is best-effort */
  }
}

function reloadSinkhole(): void {
  if (!sinkholeState().enabled) return;
  setSinkholeDomains(badDomains());
}
