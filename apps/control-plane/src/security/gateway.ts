/**
 * Gateway / network-edge control. Three modes, all OFF by default and reverted by
 * a kill switch + dead-man watchdog:
 *   • device — forward + NAT one pilot device through Nexrelm (visibility pilot).
 *   • lan    — be the LAN gateway: route + NAT the whole subnet (Nexrelm on path).
 * Plus router-level controls: WAN→LAN port-forwards (exported as nft to apply,
 * same pattern as the firewall) and a DHCP hand-off that makes Nexrelm advertise
 * itself as DNS + the authoritative server so clients actually route through it.
 * All privileged routing goes through the vetted root helper (sudo NOPASSWD).
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { GatewayMode, GatewayState, PortForward } from '@nexrelm/types';
import { applyDhcpSettings } from '../dhcp';
import { pushLog } from '../core/logbus';

const HELPER = '/usr/local/sbin/nexrelm-gateway';
const IPV4_CIDR = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/;
const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/;
const DATA_DIR = process.env.NEXRELM_DATA ?? path.join(os.homedir(), '.nexrelm');
const FILE = path.join(DATA_DIR, 'gateway.json');

let mode: GatewayMode = 'off';
let client = '';
let lanSubnet = '';
let wan = '';
let forwards: PortForward[] = [];
let dhcpHandoff = false;
let lastError: string | undefined;
let heartbeat: ReturnType<typeof setInterval> | null = null;

(function load(): void {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8')) as { forwards?: PortForward[]; dhcpHandoff?: boolean };
    forwards = Array.isArray(raw.forwards) ? raw.forwards : [];
    dhcpHandoff = !!raw.dhcpHandoff;
  } catch {
    /* defaults */
  }
})();

function persist(): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify({ forwards, dhcpHandoff }, null, 2));
  } catch {
    /* best effort */
  }
}

function run(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('sudo', ['-n', HELPER, ...args], { timeout: 8000 }, (err, out, errOut) => {
      if (err) reject(new Error((errOut || err.message || '').trim().split('\n').slice(-1)[0] || 'helper failed'));
      else resolve((out || '').trim());
    });
  });
}
function probe(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => execFile(cmd, args, { timeout: 3000 }, (_e, out) => resolve(out || '')));
}

export async function detectWan(): Promise<string> {
  const out = await probe('ip', ['route', 'show', 'default']);
  return out.match(/\bdev\s+(\S+)/)?.[1] ?? '';
}
export async function detectLan(): Promise<{ ip: string; cidr: string; iface: string }> {
  const out = await probe('ip', ['-4', '-o', 'addr', 'show', 'scope', 'global']);
  for (const line of out.split('\n')) {
    const m = line.match(/^\d+:\s+(\S+)\s+inet\s+(\d+\.\d+\.\d+\.\d+)\/(\d+)/);
    if (m && !/^(virbr|docker|br-|veth|tun|lo)/.test(m[1]!)) {
      const [, iface, ip, prefixRaw] = m;
      const prefix = Number(prefixRaw);
      const p = ip!.split('.').map(Number);
      const ipi = ((p[0]! << 24) | (p[1]! << 16) | (p[2]! << 8) | p[3]!) >>> 0;
      const mask = prefix >= 32 ? 0xffffffff : (~((1 << (32 - prefix)) - 1)) >>> 0;
      const net = ipi & mask;
      return { ip: ip!, cidr: `${(net >>> 24) & 255}.${(net >>> 16) & 255}.${(net >>> 8) & 255}.${net & 255}/${prefix}`, iface: iface! };
    }
  }
  return { ip: '', cidr: '', iface: '' };
}

function startHeartbeat(): void {
  if (heartbeat) clearInterval(heartbeat);
  heartbeat = setInterval(() => {
    run(['heartbeat']).catch((e) => {
      lastError = e instanceof Error ? e.message : 'heartbeat failed';
    });
  }, 20_000);
}

export async function gatewayStatus(): Promise<GatewayState> {
  const [wanIf, lan] = await Promise.all([detectWan(), detectLan()]);
  const runAs = (() => {
    try {
      return os.userInfo().username;
    } catch {
      return process.env.USER || undefined;
    }
  })();
  // Helper FILE present is a cheap, always-works check (no sudo). Whether we can
  // actually *invoke* it via `sudo -n` is a separate, environment-sensitive thing
  // (right user in sudoers, a usable PATH, NoNewPrivileges off). Report them apart
  // so the UI can say "installed but not invokable" instead of a wrong "not installed".
  const installed = fs.existsSync(HELPER);
  let available = false;
  let helperStatus: string | undefined;
  let ipForward: boolean | undefined;
  if (!installed) {
    helperStatus = 'helper not installed — run: sudo bash deploy/install-gateway.sh';
  } else {
    try {
      const out = await run(['status']);
      available = true;
      ipForward = /ip_forward=1/.test(out);
      if (out.startsWith('disabled')) mode = 'off';
      helperStatus = out;
    } catch (e) {
      // File is there but sudo refused — almost always a user mismatch between the
      // sudoers entry and the user the control plane runs as. Surface both so the
      // operator can re-run the installer for the right user without guessing.
      const why = e instanceof Error ? e.message : 'sudo invocation failed';
      helperStatus = `helper installed but not invokable as '${runAs ?? 'unknown'}': ${why} — re-run: sudo NEXRELM_USER=${runAs ?? '<service-user>'} bash deploy/install-gateway.sh`;
    }
  }
  return { available, installed, runAs, enabled: mode !== 'off', mode, client, lanSubnet, wan: wan || wanIf, lanIp: lan.ip, ipForward, forwards, dhcpHandoff, helperStatus, error: lastError };
}

export async function enableGateway(clientCidr: string): Promise<GatewayState> {
  lastError = undefined;
  const c = (clientCidr || '').trim();
  if (!IPV4_CIDR.test(c)) throw new Error('invalid pilot client — use an IP or CIDR, e.g. 192.168.1.42 or 192.168.1.0/28');
  const wanIf = await detectWan();
  if (!wanIf) throw new Error('could not determine the WAN interface (no default route)');
  await run(['enable', wanIf, c]);
  mode = 'device';
  client = c;
  lanSubnet = '';
  wan = wanIf;
  startHeartbeat();
  pushLog('security', 'warn', `inline gateway ON — routing pilot device ${c} through Nexrelm`);
  return gatewayStatus();
}

export async function enableLanGateway(subnet?: string): Promise<GatewayState> {
  lastError = undefined;
  const wanIf = await detectWan();
  if (!wanIf) throw new Error('could not determine the WAN interface (no default route)');
  const lan = await detectLan();
  const cidr = (subnet || lan.cidr || '').trim();
  if (!IPV4_CIDR.test(cidr) || !cidr.includes('/')) throw new Error('invalid LAN subnet — use a CIDR, e.g. 192.168.1.0/24');
  await run(['enable-lan', wanIf, cidr]);
  mode = 'lan';
  lanSubnet = cidr;
  client = '';
  wan = wanIf;
  startHeartbeat();
  pushLog('security', 'warn', `LAN gateway ON — routing the whole subnet ${cidr} through Nexrelm`);
  return gatewayStatus();
}

export async function disableGateway(): Promise<GatewayState> {
  if (heartbeat) {
    clearInterval(heartbeat);
    heartbeat = null;
  }
  try {
    await run(['disable']);
  } catch (e) {
    lastError = e instanceof Error ? e.message : 'disable failed';
  }
  const was = mode;
  mode = 'off';
  client = '';
  lanSubnet = '';
  if (was !== 'off') pushLog('security', 'info', 'gateway routing disabled (kill switch) — traffic reverted');
  return gatewayStatus();
}

// ── port forwarding (DNAT) — stored here, applied to the OS via the nft export ──
export function addForward(f: { proto: 'tcp' | 'udp'; wanPort: number; toHost: string; toPort: number; comment?: string }): PortForward[] {
  if (f.proto !== 'tcp' && f.proto !== 'udp') throw new Error('proto must be tcp | udp');
  if (!Number.isInteger(f.wanPort) || f.wanPort < 1 || f.wanPort > 65535) throw new Error('invalid WAN port');
  if (!Number.isInteger(f.toPort) || f.toPort < 1 || f.toPort > 65535) throw new Error('invalid destination port');
  if (!IPV4.test(f.toHost)) throw new Error('destination host must be an internal IPv4');
  forwards = [...forwards, { id: randomUUID(), proto: f.proto, wanPort: f.wanPort, toHost: f.toHost, toPort: f.toPort, comment: f.comment }];
  persist();
  return forwards;
}
export function delForward(id: string): PortForward[] {
  forwards = forwards.filter((f) => f.id !== id);
  persist();
  return forwards;
}
export function exportForwardsNft(wanOverride?: string): string {
  if (!forwards.length) return '# no port forwards configured\n';
  const w = wanOverride || wan || 'eth0';
  const rules = forwards.map((f) => `    iifname "${w}" ${f.proto} dport ${f.wanPort} dnat to ${f.toHost}:${f.toPort}`).join('\n');
  return `# Apply with:  sudo nft -f -\ntable ip nexrelm_dnat {\n  chain prerouting {\n    type nat hook prerouting priority -100; policy accept;\n${rules}\n  }\n}\n`;
}

// ── DHCP hand-off: make Nexrelm's DHCP advertise itself as DNS + be authoritative ──
export async function setDhcpHandoff(on: boolean): Promise<GatewayState> {
  try {
    await applyDhcpSettings(on ? { enabled: true, authoritative: true, useOwnDns: true } : { useOwnDns: false });
    dhcpHandoff = on;
    persist();
    pushLog('dhcp', 'info', on ? 'DHCP hand-off ON — advertising Nexrelm as DNS + authoritative server' : 'DHCP hand-off off — clients use custom DNS');
  } catch (e) {
    lastError = e instanceof Error ? e.message : 'dhcp hand-off failed';
  }
  return gatewayStatus();
}
