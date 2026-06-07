/**
 * Real network topology — built live from every source Nexrelm already has, not
 * simulated. To stay readable on a large network it shows infrastructure as
 * individual nodes and collapses populations into single count nodes:
 *   • gateway, this host, each AD Domain Controller, and every server (AD member
 *     servers + server-like inventory devices) get their own node;
 *   • all AD users collapse into one "Users · N" node hung off the DC;
 *   • domain-joined workstations collapse into one "Domain workstations · N" node;
 *   • the unclassified LAN endpoint long-tail collapses into one node.
 * AD computers are matched to inventory by hostname so a host appears once with
 * both its AD identity and its live IP. AD queries are cached ~60s.
 */
import { execFile } from 'node:child_process';
import type { AdComputer, AdGroup, AdUser, TopoLink, TopoNode, Topology } from '@nexrelm/types';
import { inventory } from '../security/inventory';
import { directory } from '../directory/ldap';
import { vmStore } from '../vms/store';

function probe(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => execFile(cmd, args, { timeout: 3000 }, (_e, out) => resolve(out || '')));
}
async function gatewayIp(): Promise<string> {
  const out = await probe('ip', ['route', 'show', 'default']);
  return out.match(/default via (\d+\.\d+\.\d+\.\d+)/)?.[1] ?? '';
}
async function lanIp(): Promise<string> {
  const out = await probe('ip', ['-4', '-o', 'addr', 'show', 'scope', 'global']);
  for (const line of out.split('\n')) {
    const m = line.match(/^\d+:\s+(\S+)\s+inet\s+(\d+\.\d+\.\d+\.\d+)/);
    if (m && !/^(virbr|docker|br-|veth|tun|lo)/.test(m[1]!)) return m[2]!;
  }
  return '';
}

const shortName = (s?: string): string => (s ?? '').split('.')[0]!.toLowerCase();
// A device that exposes several services or whose name reads like infrastructure
// is shown as its own server node; everything else is part of the endpoint tail.
const SERVER_RE = /nas|srv|server|esxi|vmware|proxmox|vcenter|hyperv|\bdc\d|gateway|firewall|router|switch/i;

// Loopback, all-zeros, limited-broadcast and multicast/reserved (≥224) are not real
// endpoints — keep them out of the map.
const isRealEndpoint = (ip: string): boolean =>
  !!ip && !ip.startsWith('127.') && ip !== '0.0.0.0' && ip !== '255.255.255.255' && Number(ip.split('.')[0]) < 224;

interface AdSnap {
  computers: AdComputer[];
  users: AdUser[];
  groups: AdGroup[];
  domain: string;
}
let adCache: { at: number; snap: AdSnap } | null = null;
async function adSnapshot(): Promise<AdSnap | null> {
  const ds = directory.status();
  if (!ds.connected) return null;
  if (adCache && Date.now() - adCache.at < 60_000) return adCache.snap;
  try {
    const [computers, users, groups] = await Promise.all([directory.computers(), directory.users(), directory.groups()]);
    adCache = { at: Date.now(), snap: { computers, users, groups, domain: ds.domain ?? '' } };
    return adCache.snap;
  } catch {
    return adCache?.snap ?? null;
  }
}

export async function buildTopology(): Promise<Topology> {
  const nodes: TopoNode[] = [];
  const links: TopoLink[] = [];
  const seenIp = new Set<string>();
  const consumed = new Set<string>(); // inventory hostnames claimed by an AD computer
  const add = (n: TopoNode): TopoNode => {
    nodes.push(n);
    if (n.ip) seenIp.add(n.ip);
    return n;
  };
  const link = (source: string, target: string, state: 'up' | 'degraded' | 'down' = 'up', mbps = 8): void => {
    links.push({ id: `${source}>${target}`, source, target, state, throughputMbps: mbps });
  };

  const [gw, lan, devices, ad] = await Promise.all([gatewayIp(), lanIp(), inventory(), adSnapshot()]);
  const byHost = new Map<string, (typeof devices)[number]>();
  for (const d of devices) if (d.hostname) byHost.set(shortName(d.hostname), d);
  const matchOf = (c: AdComputer): (typeof devices)[number] | undefined =>
    byHost.get(shortName(c.name)) ?? (c.dnsName ? byHost.get(shortName(c.dnsName)) : undefined);

  // gateway / router + this host (the control plane)
  add({ id: 'gw', label: gw ? `gateway · ${gw}` : 'gateway / router', kind: 'gateway', ip: gw, status: 'online', load: 0.4, meta: { role: 'default gateway' } });
  add({ id: 'nexrelm', label: 'Nexrelm', kind: 'server', ip: lan, status: 'online', load: 0.3, meta: { role: 'control plane' } });
  link('nexrelm', 'gw', 'up', 100);

  // ── Active Directory: DC + every member server individually; users and
  //    workstations each collapse into a single count node hung off the DC. ──
  let dcId: string | undefined;
  const anchor = (): string => dcId ?? 'gw';
  if (ad) {
    const admins = ad.users.filter((u) => u.admin).length;
    const adServers = ad.computers.filter((c) => c.isDc || c.isServer);
    const workstations = ad.computers.filter((c) => !c.isDc && !c.isServer);

    for (const c of adServers) {
      const m = matchOf(c);
      if (m?.hostname) consumed.add(shortName(m.hostname));
      const meta: Record<string, string | number> = { domain: ad.domain, os: c.os ?? '' };
      if (c.isDc) Object.assign(meta, { role: 'Domain Controller', users: ad.users.length, admins, groups: ad.groups.length, computers: ad.computers.length });
      else meta.role = 'server';
      add({ id: `ad:${c.name}`, label: c.isDc ? `${c.name} · DC` : c.name, kind: 'server', ip: m?.ip, mac: m?.mac, status: (m?.online ?? c.enabled) ? 'online' : 'offline', load: c.isDc ? 0.5 : 0.3, meta });
      if (c.isDc && !dcId) dcId = `ad:${c.name}`;
    }
    if (dcId) link(dcId, 'gw', 'up', 80);
    for (const c of adServers) if (!c.isDc) link(`ad:${c.name}`, anchor(), 'up', 20);

    // claim workstation inventory matches + count how many are live
    let wsOnline = 0;
    for (const c of workstations) {
      const m = matchOf(c);
      if (m?.hostname) consumed.add(shortName(m.hostname));
      if (m?.online ?? c.enabled) wsOnline++;
    }

    if (ad.users.length) {
      add({ id: 'ad-users', label: `Users · ${ad.users.length}`, kind: 'unknown', status: 'online', load: 0.55, meta: { role: 'AD users', users: ad.users.length, admins, groups: ad.groups.length, domain: ad.domain } });
      link('ad-users', anchor(), 'up', 6);
    }
    if (workstations.length) {
      add({ id: 'ad-workstations', label: `Domain workstations · ${workstations.length}`, kind: 'host', status: wsOnline ? 'online' : 'offline', load: 0.45, meta: { role: 'domain-joined workstations', total: workstations.length, online: wsOnline, domain: ad.domain } });
      link('ad-workstations', anchor(), 'up', 12);
    }
  }

  // ── inventory: server-like devices individually, the rest as one tail node ──
  const isServerish = (d: (typeof devices)[number]): boolean => d.openPorts.length >= 3 || SERVER_RE.test(d.hostname ?? '');
  let epOnline = 0;
  let epOffline = 0;
  const epNames: string[] = [];
  for (const d of devices) {
    if (!d.ip || d.ip === gw || d.ip === lan || seenIp.has(d.ip) || !isRealEndpoint(d.ip)) continue;
    if (d.hostname && consumed.has(shortName(d.hostname))) continue;
    if (isServerish(d)) {
      const meta: Record<string, string | number> = { os: d.os, vendor: d.vendor ?? '', openPorts: d.openPorts.length };
      if (d.risk) meta.risk = d.risk;
      add({ id: `dev:${d.ip}`, label: d.hostname || d.ip, kind: 'server', ip: d.ip, mac: d.mac, status: d.online ? 'online' : 'offline', load: Math.min(1, (d.queries ?? 0) / 500), meta });
      link(`dev:${d.ip}`, 'gw', d.online ? 'up' : 'down', 8);
    } else if (d.online) {
      epOnline++;
      if (d.hostname && epNames.length < 8) epNames.push(d.hostname);
    } else {
      epOffline++;
    }
  }
  const epTotal = epOnline + epOffline;
  if (epTotal) {
    const meta: Record<string, string | number> = { role: 'unclassified LAN devices', total: epTotal, online: epOnline, offline: epOffline };
    if (epNames.length) meta.examples = epNames.join(', ');
    add({ id: 'lan-endpoints', label: `LAN endpoints · ${epTotal}`, kind: 'unknown', status: epOnline ? 'online' : 'offline', load: Math.min(0.9, 0.3 + epTotal / 200), meta });
    link('lan-endpoints', 'gw', epOnline ? 'up' : 'down', 10);
  }

  // ── managed VMs ──
  for (const vm of vmStore.list()) {
    const ip = vm.stats?.ipAddrs?.[0];
    if (ip && seenIp.has(ip)) continue;
    add({ id: `vm:${vm.id}`, label: vm.name, kind: 'vm', ip, status: vm.stats?.reachable ? 'online' : 'offline', load: Math.min(1, (vm.stats?.cpuPct ?? 0) / 100), meta: { host: vm.host, os: vm.stats?.os ?? '' } });
    link(`vm:${vm.id}`, 'gw', vm.stats?.reachable ? 'up' : 'down', 15);
  }

  return { nodes, links, updatedAt: new Date().toISOString() };
}
