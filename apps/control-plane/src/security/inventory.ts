/**
 * Network device inventory — security is network-wide, not just this host. Merges
 * three real sources: the kernel ARP/neighbour table (`ip neigh`, non-root), the
 * DNS resolver's tracked clients, and the last nmap scan's open ports. An active
 * `nmap -sn` sweep discovers devices that haven't talked to us yet. Persisted so
 * devices are remembered across restarts.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import type { ClientOs, DeviceDiscovery, ScanService, SecSeverity, SecurityDevice } from '@nexrelm/types';
import { clientsAll } from '../dns';
import { vendorForMac } from '../dns/presets';
import { classifyOs } from './analytics';
import { currentScan } from './scan';
import { sniffedHosts } from './sniffer';

const DATA_DIR = process.env.NEXRELM_DATA ?? path.join(os.homedir(), '.nexrelm');
const FILE = process.env.NEXRELM_DEVICES_DB ?? path.join(DATA_DIR, 'security-devices.json');

interface StoredDevice {
  ip: string;
  mac?: string;
  hostname?: string;
  firstSeen: string;
  lastSeen: string;
  sources: string[];
}

let store: Record<string, StoredDevice> | null = null;
let discovery: { running: boolean; subnet: string; lastRun?: string; found: number } = { running: false, subnet: '', found: 0 };

function load(): Record<string, StoredDevice> {
  if (store) return store;
  try {
    store = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    store = {};
  }
  return store!;
}
function persist(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(store ?? {}, null, 2));
}

function touch(ip: string, patch: Partial<StoredDevice> & { source: string }): void {
  const s = load();
  const now = new Date().toISOString();
  const d = s[ip] ?? { ip, firstSeen: now, lastSeen: now, sources: [] };
  d.lastSeen = now;
  if (patch.mac) d.mac = patch.mac;
  if (patch.hostname) d.hostname = patch.hostname;
  if (!d.sources.includes(patch.source)) d.sources.push(patch.source);
  s[ip] = d;
}

function run(cmd: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve) => execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (_e, out) => resolve(out || '')));
}

/** The LAN CIDR from the first non-virtual global IPv4 interface. */
export async function localSubnet(): Promise<string> {
  const out = await run('ip', ['-4', '-o', 'addr', 'show', 'scope', 'global'], 3000);
  for (const line of out.split('\n')) {
    const m = line.match(/^\d+:\s+(\S+)\s+inet\s+(\d+\.\d+\.\d+\.\d+)\/(\d+)/);
    if (!m) continue;
    const [, iface, ip, prefixRaw] = m;
    if (/^(virbr|docker|br-|veth|tun|lo)/.test(iface!)) continue;
    const prefix = Number(prefixRaw);
    const parts = ip!.split('.').map(Number);
    const ipi = ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0;
    const mask = prefix >= 32 ? 0xffffffff : (~((1 << (32 - prefix)) - 1)) >>> 0;
    const net = ipi & mask;
    return `${(net >>> 24) & 255}.${(net >>> 16) & 255}.${(net >>> 8) & 255}.${net & 255}/${prefix}`;
  }
  return '192.168.1.0/24';
}

async function readNeighbors(): Promise<Array<{ ip: string; mac: string; online: boolean }>> {
  const out = await run('ip', ['neigh', 'show'], 3000);
  const rows: Array<{ ip: string; mac: string; online: boolean }> = [];
  for (const line of out.split('\n')) {
    const m = line.match(/^(\d+\.\d+\.\d+\.\d+)\s+dev\s+\S+\s+lladdr\s+([0-9a-f:]{17})\s+(\w+)/i);
    if (!m) continue;
    const state = m[3]!.toUpperCase();
    if (state === 'FAILED' || state === 'INCOMPLETE') continue;
    rows.push({ ip: m[1]!, mac: m[2]!.toLowerCase(), online: ['REACHABLE', 'DELAY', 'PROBE'].includes(state) });
  }
  return rows;
}

function riskOf(ports: ScanService[]): SecSeverity | undefined {
  const order: SecSeverity[] = ['critical', 'high', 'medium', 'low', 'info'];
  for (const sev of order) if (ports.some((p) => p.risk === sev)) return sev;
  return undefined;
}

/** Merge all live sources into the current device list (cheap; no scanning). */
export async function inventory(): Promise<SecurityDevice[]> {
  const neighbors = await readNeighbors();
  const live = new Set(neighbors.filter((n) => n.online).map((n) => n.ip));
  for (const n of neighbors) touch(n.ip, { mac: n.mac, source: 'arp' });

  // DNS clients → hostname/mac/vendor/queries
  const clients = clientsAll();
  const dnsByIp = new Map(clients.map((c) => [c.ip, c]));
  for (const c of clients) touch(c.ip, { mac: c.mac, hostname: c.nickname || c.name, source: 'dns' });

  // last scan → open ports per ip
  const scan = currentScan();
  const scanByIp = new Map((scan?.hosts ?? []).map((h) => [h.host, h]));
  for (const h of scan?.hosts ?? []) if (h.up) touch(h.host, { source: 'scan' });

  // hosts observed on the wire by the passive sniffer
  for (const ip of sniffedHosts()) touch(ip, { source: 'sniff' });

  persist();

  const s = load();
  const recentMs = Date.now() - 10 * 60 * 1000;
  return Object.values(s)
    .map((d): SecurityDevice => {
      const dns = dnsByIp.get(d.ip);
      const host = scanByIp.get(d.ip);
      const mac = d.mac ?? dns?.mac;
      const vendor = dns?.vendor ?? (mac ? vendorForMac(mac) : undefined);
      const hostname = d.hostname ?? dns?.nickname ?? dns?.name;
      const openPorts = host?.services ?? [];
      return {
        ip: d.ip,
        mac,
        vendor,
        hostname,
        os: classifyOs({ name: hostname, vendor, osHint: host?.os }),
        online: live.has(d.ip) || new Date(d.lastSeen).getTime() > recentMs,
        firstSeen: d.firstSeen,
        lastSeen: d.lastSeen,
        queries: dns?.queries ?? 0,
        sources: d.sources,
        openPorts,
        scripts: host?.scripts,
        risk: riskOf(openPorts),
        scanned: scanByIp.has(d.ip),
      };
    })
    .sort((a, b) => Number(b.online) - Number(a.online) || b.queries - a.queries || a.ip.localeCompare(b.ip));
}

export function discoveryState(): DeviceDiscovery {
  return { ...discovery, devices: [] };
}

/** Active discovery: nmap ping/ARP sweep populates the neighbour table, then merge. */
export async function startDiscovery(subnet?: string): Promise<DeviceDiscovery> {
  if (discovery.running) return { ...discovery, devices: [] };
  const target = subnet?.trim() || (await localSubnet());
  if (!/^[0-9.]+\/\d{1,2}$|^[0-9.]+$/.test(target)) throw new Error('invalid subnet — use CIDR like 192.168.1.0/24');
  discovery = { running: true, subnet: target, found: 0, lastRun: discovery.lastRun };
  execFile('nmap', ['-sn', '-T4', '--max-retries', '1', target], { timeout: 180_000, maxBuffer: 8 * 1024 * 1024 }, async () => {
    const n = await readNeighbors();
    for (const x of n) touch(x.ip, { mac: x.mac, source: 'arp' });
    persist();
    discovery = { running: false, subnet: target, lastRun: new Date().toISOString(), found: n.length };
  });
  return { ...discovery, devices: [] };
}
