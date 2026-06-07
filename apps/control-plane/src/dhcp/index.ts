/** DHCP subsystem entry — control surface + statistics. */
import type { DhcpServerSettings, DhcpServerStatus, DhcpServerStats } from '@nexrelm/types';
import {
  exclusionsAll,
  getServerSettings,
  ipToInt,
  leasesAll,
  reservationsAll,
  saveServerSettings,
  scopesAll,
} from './db';
import { dhcpServer } from './server';

export * from './db';
export { dhcpServer };
export { OPTION_CATALOG } from './options';

/** Start the server only if enabled (it conflicts with the router's DHCP). */
export async function startDhcp(): Promise<DhcpServerStatus> {
  const s = getServerSettings();
  if (!s.enabled) return dhcpServer.status();
  return dhcpServer.start(s);
}

export async function applyDhcpSettings(patch: Partial<DhcpServerSettings>): Promise<DhcpServerStatus> {
  const after = saveServerSettings(patch);
  if (after.enabled) return dhcpServer.start(after); // (re)bind with fresh settings
  await dhcpServer.stop();
  return dhcpServer.status();
}

export function dhcpStatus(): DhcpServerStatus {
  return dhcpServer.status();
}

export function computeDhcpStats(): DhcpServerStats {
  const scopes = scopesAll();
  const now = Date.now();
  let total = 0;
  let inUse = 0;
  const perScope = scopes.map((s) => {
    const rangeTotal = Math.max(0, ipToInt(s.rangeEnd) - ipToInt(s.rangeStart) + 1);
    const exclTotal = exclusionsAll(s.id).reduce((a, e) => a + Math.max(0, ipToInt(e.end) - ipToInt(e.start) + 1), 0);
    const scopeTotal = Math.max(0, rangeTotal - exclTotal);
    const active = leasesAll(s.id).filter((l) => (l.state === 'active' || l.state === 'reserved') && new Date(l.expiresAt).getTime() > now).length;
    total += scopeTotal;
    inUse += active;
    return { scopeId: s.id, name: s.name, inUse: active, total: scopeTotal, utilization: scopeTotal ? active / scopeTotal : 0 };
  });

  const c = dhcpServer.counters;
  return {
    scopes: scopes.length,
    totalAddresses: total,
    inUse,
    available: Math.max(0, total - inUse),
    reserved: reservationsAll().length,
    utilization: total ? inUse / total : 0,
    discovers: c.discovers,
    offers: c.offers,
    requests: c.requests,
    acks: c.acks,
    naks: c.naks,
    declines: c.declines,
    releases: c.releases,
    informs: c.informs,
    perScope,
  };
}
