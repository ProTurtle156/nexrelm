/**
 * Network posture — how Nexrelm is integrated into the LAN right now, across the
 * stacking modes (DNS · DHCP · passive capture · inline gateway). Each is read
 * from the real module state so the Gateway page can show what's active and what
 * each mode unlocks. Nexrelm sits as a node on the LAN — none of these require a
 * separate WAN; "be the gateway" simply routes through whichever interface
 * reaches the internet.
 */
import type { NetworkPosture } from '@nexrelm/types';
import { computeStats } from '../dns';
import { dhcpStatus, computeDhcpStats, applyDhcpSettings } from '../dhcp';
import { snifferState } from './sniffer';
import { gatewayStatus } from './gateway';

export async function networkPosture(): Promise<NetworkPosture> {
  const gateway = await gatewayStatus();

  let dnsClients = 0;
  let dnsQueries = 0;
  try {
    const s = computeStats();
    dnsQueries = s.totalQueries;
    dnsClients = s.uniqueClients;
  } catch {
    /* dns not ready */
  }

  let dhcpUp = false;
  let leases = 0;
  try {
    dhcpUp = dhcpStatus().running;
    leases = computeDhcpStats().inUse;
  } catch {
    /* dhcp off */
  }

  const sn = snifferState();

  return {
    lanIp: gateway.lanIp,
    // "active" = real external clients are using us, not just this host
    dns: { active: dnsClients > 1 || dnsQueries > 50, clients: dnsClients, queries: dnsQueries },
    dhcp: { active: dhcpUp, leases },
    capture: { active: sn.running, packets: sn.packets, iface: sn.iface },
    gateway,
  };
}

/** Turn Nexrelm's DHCP server on/off (DHCP-only mode). */
export async function setDhcpServer(enabled: boolean): Promise<NetworkPosture> {
  await applyDhcpSettings({ enabled });
  return networkPosture();
}
