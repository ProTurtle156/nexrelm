/**
 * Backend system settings — data retention + maintenance, enforced not advisory.
 * DNS retention stays with the resolver's own settings (dbMaxDays/ipMaxDays —
 * one source of truth; writes are routed through applyDnsSettings). This module
 * owns the security-event / DHCP-lease retention and the log-buffer size,
 * persists them to ~/.nexrelm/system.json, applies them live, and runs an
 * hourly prune across all three databases.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SystemInfo, SystemPruneResult, SystemSettings, SystemStorageFile } from '@nexrelm/types';
import { getSettings as getDnsSettings, pruneByAge as pruneDns } from '../dns/db';
import { applyDnsSettings } from '../dns';
import { pruneEventsByAge } from '../security/store';
import { pruneLeasesByAge } from '../dhcp/db';
import { pushLog, setLogCapacity } from './logbus';

const DATA_DIR = process.env.NEXRELM_DATA ?? path.join(os.homedir(), '.nexrelm');
const FILE = path.join(DATA_DIR, 'system.json');

interface LocalSettings {
  securityEventRetentionDays: number;
  dhcpLeaseRetentionDays: number;
  logBufferLines: number;
}
const DEFAULTS: LocalSettings = { securityEventRetentionDays: 30, dhcpLeaseRetentionDays: 30, logBufferLines: 2000 };

const clampDays = (v: unknown, fallback: number): number => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.min(365, Math.max(0, n)) : fallback;
};
const clampLines = (v: unknown, fallback: number): number => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.min(20000, Math.max(200, n)) : fallback;
};

function loadLocal(): LocalSettings {
  try {
    return { ...DEFAULTS, ...(JSON.parse(fs.readFileSync(FILE, 'utf8')) as Partial<LocalSettings>) };
  } catch {
    return { ...DEFAULTS };
  }
}
function saveLocal(s: LocalSettings): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(s, null, 2));
}

export function getSystemSettings(): SystemSettings {
  const local = loadLocal();
  const dns = getDnsSettings();
  return { dnsQueryRetentionDays: dns.dbMaxDays, dnsClientRetentionDays: dns.ipMaxDays, ...local };
}

export async function saveSystemSettings(patch: Partial<SystemSettings>): Promise<SystemSettings> {
  const cur = getSystemSettings();
  const next: SystemSettings = {
    dnsQueryRetentionDays: clampDays(patch.dnsQueryRetentionDays ?? cur.dnsQueryRetentionDays, cur.dnsQueryRetentionDays),
    dnsClientRetentionDays: clampDays(patch.dnsClientRetentionDays ?? cur.dnsClientRetentionDays, cur.dnsClientRetentionDays),
    securityEventRetentionDays: clampDays(patch.securityEventRetentionDays ?? cur.securityEventRetentionDays, cur.securityEventRetentionDays),
    dhcpLeaseRetentionDays: clampDays(patch.dhcpLeaseRetentionDays ?? cur.dhcpLeaseRetentionDays, cur.dhcpLeaseRetentionDays),
    logBufferLines: clampLines(patch.logBufferLines ?? cur.logBufferLines, cur.logBufferLines),
  };
  saveLocal({
    securityEventRetentionDays: next.securityEventRetentionDays,
    dhcpLeaseRetentionDays: next.dhcpLeaseRetentionDays,
    logBufferLines: next.logBufferLines,
  });
  setLogCapacity(next.logBufferLines);
  // DNS retention belongs to the resolver settings — route it there (prunes immediately, no rebind)
  if (next.dnsQueryRetentionDays !== cur.dnsQueryRetentionDays || next.dnsClientRetentionDays !== cur.dnsClientRetentionDays) {
    await applyDnsSettings({ dbMaxDays: next.dnsQueryRetentionDays, ipMaxDays: next.dnsClientRetentionDays });
  }
  pushLog(
    'system',
    'info',
    `system settings saved — retention dns ${next.dnsQueryRetentionDays}d / clients ${next.dnsClientRetentionDays}d / events ${next.securityEventRetentionDays}d / leases ${next.dhcpLeaseRetentionDays}d · log buffer ${next.logBufferLines} lines`,
  );
  return getSystemSettings();
}

/** Enforce retention across every store right now. */
export function pruneNow(): SystemPruneResult {
  const s = getSystemSettings();
  const dns = pruneDns(s.dnsQueryRetentionDays, s.dnsClientRetentionDays);
  return {
    dnsQueries: dns.queries,
    dnsClients: dns.clients,
    securityEvents: pruneEventsByAge(s.securityEventRetentionDays),
    dhcpLeases: pruneLeasesByAge(s.dhcpLeaseRetentionDays),
  };
}

/** Real on-disk footprint of ~/.nexrelm (WAL/SHM side-files folded out). */
export function storageInfo(): SystemStorageFile[] {
  try {
    return fs
      .readdirSync(DATA_DIR)
      .filter((f) => !f.endsWith('-wal') && !f.endsWith('-shm') && !f.endsWith('.tmp'))
      .map((f) => ({ file: f, bytes: fs.statSync(path.join(DATA_DIR, f)).size }))
      .sort((a, b) => b.bytes - a.bytes);
  } catch {
    return [];
  }
}

export function systemInfo(): SystemInfo {
  return { settings: getSystemSettings(), storage: storageInfo() };
}

let timer: NodeJS.Timeout | null = null;

/** Apply persisted settings at boot and prune hourly. */
export function startSystemMaintenance(): void {
  setLogCapacity(loadLocal().logBufferLines);
  const run = (): void => {
    try {
      const r = pruneNow();
      const total = r.dnsQueries + r.dnsClients + r.securityEvents + r.dhcpLeases;
      if (total > 0) {
        pushLog('system', 'info', `retention prune — removed ${r.dnsQueries} queries, ${r.dnsClients} clients, ${r.securityEvents} events, ${r.dhcpLeases} leases`);
      }
    } catch (e) {
      pushLog('system', 'warn', `retention prune failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  run();
  if (!timer) {
    timer = setInterval(run, 3600_000);
    timer.unref();
  }
}
