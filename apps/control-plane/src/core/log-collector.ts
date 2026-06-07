/**
 * Heartbeat collector — guarantees the unified log keeps flowing from EVERY
 * sector even when a sector is quiet, by sampling each module's REAL state on an
 * interval and emitting one honest summary line. Event-driven logs (a blocked
 * query, a flagged threat, a new lease) come from the modules themselves; this
 * fills the gaps so the console always shows the whole system is alive.
 */
import { pushLog } from './logbus';
import { computeStats } from '../dns';
import { dhcpStatus, computeDhcpStats } from '../dhcp';
import { directory } from '../directory/ldap';
import { registryAll } from '../security/registry';
import { snifferState } from '../security/sniffer';
import { recentEvents } from '../security/events';
import { vmStore } from '../vms/store';

let started = false;

export function startLogCollector(intervalMs = 30_000): void {
  if (started) return;
  started = true;
  setInterval(heartbeat, intervalMs);
}

function heartbeat(): void {
  // system
  try {
    const rss = process.memoryUsage().rss / 1e6;
    pushLog('system', 'info', `control plane healthy · uptime ${Math.round(process.uptime())}s · rss ${rss.toFixed(0)}MB`);
  } catch {
    /* ignore */
  }
  // dns
  try {
    const s = computeStats();
    pushLog('dns', 'info', `resolver · ${s.totalQueries} queries/24h · ${s.blocked} blocked · ${s.cached} cached · ${s.uniqueClients} clients`);
  } catch {
    /* ignore */
  }
  // dhcp
  try {
    const up = dhcpStatus().running;
    const ds = computeDhcpStats();
    pushLog('dhcp', up ? 'info' : 'debug', up ? `dhcp server up · ${ds.inUse}/${ds.totalAddresses} leases in use · ${ds.acks} ACKs` : 'dhcp server off (router owns DHCP)');
  } catch {
    /* ignore */
  }
  // directory
  try {
    const st = directory.status();
    pushLog('directory', st.connected ? 'info' : 'debug', st.connected ? `directory connected · ${st.domain ?? ''}${st.host ? ` @ ${st.host}` : ''}` : 'directory not connected');
  } catch {
    /* ignore */
  }
  // virt
  try {
    const vms = vmStore.list();
    const online = vms.filter((v) => v.stats?.reachable).length;
    pushLog('virt', vms.length ? 'info' : 'debug', vms.length ? `virtualization · ${vms.length} VM(s) registered, ${online} reachable` : 'virtualization · no VMs registered');
  } catch {
    /* ignore */
  }
  // security
  try {
    const reg = registryAll();
    const sn = snifferState();
    pushLog('security', 'info', `security · ${reg.devices.length} devices (${reg.pending} new, ${reg.blocked} blocked) · ${recentEvents(2000).length} events · capture ${sn.running ? `on (${sn.packets} pkts)` : 'off'}`);
  } catch {
    /* ignore */
  }
}
