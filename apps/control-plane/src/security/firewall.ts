/**
 * Nexrelm policy firewall — an ordered ACL of inbound/outbound rules over
 * zones. Persisted to disk. Because the control plane is unprivileged (can't
 * touch the kernel nftables directly), it (a) enforces deny/drop at Nexrelm's
 * own surface and (b) compiles the policy to an `nft -f` script the operator
 * applies to the OS firewall. Zones group CIDRs by trust level.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import type { FirewallState, FwRule, FwRuleInput, FwZone } from '@nexrelm/types';

const DATA_DIR = process.env.NEXRELM_DATA ?? path.join(os.homedir(), '.nexrelm');
const FILE = process.env.NEXRELM_FW_DB ?? path.join(DATA_DIR, 'security-firewall.json');

let cache: FirewallState | null = null;

function seed(): FirewallState {
  return {
    enforced: true,
    zones: [
      { id: 'lan', name: 'LAN', cidrs: ['192.168.0.0/16', '10.0.0.0/8'], trust: 'trusted' },
      { id: 'guest', name: 'Guest', cidrs: ['192.168.50.0/24'], trust: 'guest' },
      { id: 'wan', name: 'WAN / Internet', cidrs: ['0.0.0.0/0'], trust: 'untrusted' },
    ],
    rules: [],
  };
}

function load(): FirewallState {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(FILE, 'utf8')) as FirewallState;
  } catch {
    cache = seed();
    persist();
  }
  return cache!;
}
function persist(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(cache ?? seed(), null, 2));
}

export function firewallState(): FirewallState {
  const s = load();
  return { ...s, rules: [...s.rules].sort((a, b) => a.order - b.order) };
}

export function setEnforced(on: boolean): FirewallState {
  load().enforced = on;
  persist();
  return firewallState();
}

export function ruleAdd(input: FwRuleInput): FwRule {
  const s = load();
  const order = s.rules.length ? Math.max(...s.rules.map((r) => r.order)) + 10 : 10;
  const rule: FwRule = {
    id: randomUUID(),
    order,
    enabled: input.enabled ?? true,
    direction: input.direction,
    action: input.action,
    proto: input.proto ?? 'any',
    source: (input.source || 'any').trim(),
    dest: (input.dest || 'any').trim(),
    port: (input.port || 'any').trim(),
    comment: input.comment,
    hits: 0,
  };
  s.rules.push(rule);
  persist();
  return rule;
}

export function ruleUpdate(id: string, patch: Partial<FwRule>): FwRule | undefined {
  const r = load().rules.find((x) => x.id === id);
  if (!r) return undefined;
  Object.assign(r, { ...patch, id: r.id });
  persist();
  return r;
}

export function ruleDelete(id: string): boolean {
  const s = load();
  const i = s.rules.findIndex((x) => x.id === id);
  if (i < 0) return false;
  s.rules.splice(i, 1);
  persist();
  return true;
}

/** Move a rule up/down in the ACL by swapping order with its neighbour. */
export function ruleReorder(id: string, dir: -1 | 1): FwRule[] {
  const ordered = firewallState().rules;
  const i = ordered.findIndex((r) => r.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= ordered.length) return ordered;
  const a = load().rules.find((r) => r.id === ordered[i]!.id)!;
  const b = load().rules.find((r) => r.id === ordered[j]!.id)!;
  [a.order, b.order] = [b.order, a.order];
  persist();
  return firewallState().rules;
}

export function zoneAdd(name: string, cidrs: string[], trust: FwZone['trust']): FwZone {
  const z: FwZone = { id: randomUUID().slice(0, 8), name: name.trim(), cidrs: cidrs.map((c) => c.trim()).filter(Boolean), trust };
  load().zones.push(z);
  persist();
  return z;
}
export function zoneDelete(id: string): boolean {
  const s = load();
  const i = s.zones.findIndex((z) => z.id === id);
  if (i < 0) return false;
  s.zones.splice(i, 1);
  persist();
  return true;
}

// ── matching ──
function ipToInt(ip: string): number | null {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  return ((+m[1]! << 24) | (+m[2]! << 16) | (+m[3]! << 8) | +m[4]!) >>> 0;
}
function inCidr(ip: string, cidr: string): boolean {
  if (cidr === 'any' || cidr === '0.0.0.0/0') return true;
  const [base, bitsRaw] = cidr.split('/');
  const ipi = ipToInt(ip);
  const basei = ipToInt(base!);
  if (ipi == null || basei == null) return ip === cidr;
  const bits = bitsRaw ? Number(bitsRaw) : 32;
  if (bits <= 0) return true;
  const mask = bits >= 32 ? 0xffffffff : (~((1 << (32 - bits)) - 1)) >>> 0;
  return (ipi & mask) === (basei & mask);
}
function sourceMatches(ruleSource: string, ip: string): boolean {
  if (ruleSource === 'any') return true;
  if (ruleSource.startsWith('zone:')) {
    const z = load().zones.find((x) => x.id === ruleSource.slice(5));
    return !!z && z.cidrs.some((c) => inCidr(ip, c));
  }
  return inCidr(ip, ruleSource);
}

/** Evaluate a source IP against the ACL (first enabled match wins). */
export function evaluate(ip: string, direction: FwRule['direction'] = 'inbound'): { action: FwRule['action']; ruleId?: string } {
  for (const r of firewallState().rules) {
    if (!r.enabled || r.direction !== direction) continue;
    if (sourceMatches(r.source, ip)) {
      r.hits++;
      persist();
      return { action: r.action, ruleId: r.id };
    }
  }
  return { action: 'allow' };
}

/** Compile the policy to an `nft -f` ruleset for the OS firewall. */
export function exportNft(): string {
  const s = firewallState();
  const zoneCidrs = (src: string): string => {
    if (src === 'any') return '0.0.0.0/0';
    if (src.startsWith('zone:')) {
      const z = s.zones.find((x) => x.id === src.slice(5));
      return z?.cidrs.join(', ') || '0.0.0.0/0';
    }
    return src;
  };
  const verdict = (a: FwRule['action']): string => (a === 'allow' ? 'accept' : a === 'deny' ? 'reject' : 'drop');
  const line = (r: FwRule): string => {
    const parts: string[] = [];
    if (r.proto !== 'any') parts.push(r.proto === 'icmp' ? 'ip protocol icmp' : `${r.proto} dport ${r.port !== 'any' ? r.port.replace('-', '-') : '0-65535'}`);
    const src = zoneCidrs(r.source);
    if (src !== '0.0.0.0/0') parts.push(`ip saddr { ${src} }`);
    parts.push(verdict(r.action));
    return `    ${parts.join(' ')}${r.comment ? ` comment "${r.comment.replace(/"/g, "'")}"` : ''}`;
  };
  const inb = s.rules.filter((r) => r.enabled && r.direction === 'inbound').map(line);
  const out = s.rules.filter((r) => r.enabled && r.direction === 'outbound').map(line);
  return [
    '#!/usr/sbin/nft -f',
    '# Generated by Nexrelm — apply with: sudo nft -f nexrelm.nft',
    'table inet nexrelm {',
    '  chain inbound {',
    '    type filter hook input priority 0; policy accept;',
    ...(inb.length ? inb : ['    # (no inbound rules)']),
    '  }',
    '  chain outbound {',
    '    type filter hook output priority 0; policy accept;',
    ...(out.length ? out : ['    # (no outbound rules)']),
    '  }',
    '}',
    '',
  ].join('\n');
}
