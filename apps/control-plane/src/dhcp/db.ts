/**
 * Persistent store for the DHCP server — scopes, exclusions, reservations,
 * leases, options, filters and policies, on Node's built-in SQLite.
 */
import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import type {
  DhcpExclusion,
  DhcpFilter,
  DhcpFilterSettings,
  DhcpLeaseInfo,
  DhcpOptionValue,
  DhcpPolicy,
  DhcpReservation,
  DhcpScopeDef,
  DhcpServerSettings,
} from '@nexrelm/types';

const DATA_DIR = process.env.NEXRELM_DATA ?? path.join(os.homedir(), '.nexrelm');
const DB_PATH = process.env.NEXRELM_DHCP_DB ?? path.join(DATA_DIR, 'dhcp.db');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
db.exec(`
  CREATE TABLE IF NOT EXISTS dhcp_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS dhcp_scopes (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, state TEXT NOT NULL DEFAULT 'active',
    subnet TEXT NOT NULL, mask TEXT NOT NULL, range_start TEXT NOT NULL, range_end TEXT NOT NULL,
    lease_seconds INTEGER NOT NULL DEFAULT 86400, options TEXT NOT NULL DEFAULT '[]'
  );
  CREATE TABLE IF NOT EXISTS dhcp_exclusions (id TEXT PRIMARY KEY, scope_id TEXT NOT NULL, start TEXT NOT NULL, end TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS dhcp_reservations (
    id TEXT PRIMARY KEY, scope_id TEXT NOT NULL, ip TEXT NOT NULL, mac TEXT NOT NULL, name TEXT, description TEXT,
    supported TEXT NOT NULL DEFAULT 'both', options TEXT NOT NULL DEFAULT '[]'
  );
  CREATE TABLE IF NOT EXISTS dhcp_leases (
    id TEXT PRIMARY KEY, scope_id TEXT NOT NULL, ip TEXT NOT NULL UNIQUE, mac TEXT NOT NULL, hostname TEXT, vendor TEXT,
    state TEXT NOT NULL, started_at TEXT NOT NULL, expires_at TEXT NOT NULL, client_id TEXT
  );
  CREATE TABLE IF NOT EXISTS dhcp_filters (id TEXT PRIMARY KEY, mac TEXT NOT NULL, type TEXT NOT NULL, description TEXT);
  CREATE TABLE IF NOT EXISTS dhcp_policies (
    id TEXT PRIMARY KEY, scope_id TEXT NOT NULL, name TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
    condition_type TEXT NOT NULL, condition_value TEXT NOT NULL, options TEXT NOT NULL DEFAULT '[]'
  );
`);

// migration: per-scope DNS selection (added after the initial schema shipped)
for (const col of ["dns_mode TEXT NOT NULL DEFAULT 'inherit'", "dns_servers TEXT NOT NULL DEFAULT '[]'"]) {
  try {
    db.exec(`ALTER TABLE dhcp_scopes ADD COLUMN ${col}`);
  } catch {
    /* column already exists */
  }
}

// ───────────────────────────── helpers ─────────────────────────────
const j = <T>(v: unknown, d: T): T => {
  try {
    return JSON.parse(String(v ?? '')) as T;
  } catch {
    return d;
  }
};
const rid = (p: string): string => `${p}_${Math.abs((Date.now() ^ (Math.random() * 1e9)) | 0).toString(36)}`;

export function ipToInt(ip: string): number {
  return ip.trim().split('.').reduce((a, o) => ((a << 8) + (Number(o) & 0xff)) >>> 0, 0) >>> 0;
}
export function intToIp(n: number): string {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff].join('.');
}
export function ipInRange(ip: string, start: string, end: string): boolean {
  const v = ipToInt(ip);
  return v >= ipToInt(start) && v <= ipToInt(end);
}

/** Best-effort LAN IPv4 (skips docker/libvirt). */
export function detectLanIp(): string | null {
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      if (/^(docker|br-|virbr|veth)/.test(name)) continue;
      if (/^(172\.1[6-9]\.|172\.2\d\.|172\.3[01]\.|192\.168\.122\.)/.test(a.address)) continue;
      return a.address;
    }
  }
  return null;
}
/** Default gateway from /proc/net/route (or null). */
export function detectGateway(): string | null {
  try {
    const lines = fs.readFileSync('/proc/net/route', 'utf8').split('\n').slice(1);
    for (const line of lines) {
      const f = line.trim().split(/\s+/);
      if (f[1] === '00000000' && f[2] && f[2] !== '00000000') {
        const h = f[2];
        return [h.slice(6, 8), h.slice(4, 6), h.slice(2, 4), h.slice(0, 2)].map((x) => parseInt(x, 16)).join('.');
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

// ───────────────────────────── settings ─────────────────────────────
function defaultSettings(): DhcpServerSettings {
  const ip = detectLanIp() ?? '192.168.1.1';
  return {
    enabled: false, // OFF by default — conflicts with the router's DHCP
    iface: '',
    serverIp: ip,
    port: 67,
    conflictDetectionAttempts: 1,
    authoritative: true,
    ddnsUpdate: false,
    useOwnDns: true,
    customDns: ['1.1.1.1', '1.0.0.1'],
    domainName: 'lan',
  };
}
export function getServerSettings(): DhcpServerSettings {
  const row = db.prepare('SELECT value FROM dhcp_settings WHERE key = ?').get('server');
  return { ...defaultSettings(), ...(row ? j<Partial<DhcpServerSettings>>(row.value, {}) : {}) };
}
export function saveServerSettings(patch: Partial<DhcpServerSettings>): DhcpServerSettings {
  const next = { ...getServerSettings(), ...patch };
  db.prepare('INSERT INTO dhcp_settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run('server', JSON.stringify(next));
  return next;
}
export function getServerOptions(): DhcpOptionValue[] {
  const row = db.prepare('SELECT value FROM dhcp_settings WHERE key = ?').get('serverOptions');
  return row ? j<DhcpOptionValue[]>(row.value, []) : [];
}
export function saveServerOptions(opts: DhcpOptionValue[]): DhcpOptionValue[] {
  db.prepare('INSERT INTO dhcp_settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run('serverOptions', JSON.stringify(opts));
  return opts;
}
export function getFilterSettings(): DhcpFilterSettings {
  const row = db.prepare('SELECT value FROM dhcp_settings WHERE key = ?').get('filterSettings');
  return { allowEnabled: false, denyEnabled: false, ...(row ? j<Partial<DhcpFilterSettings>>(row.value, {}) : {}) };
}
export function saveFilterSettings(patch: Partial<DhcpFilterSettings>): DhcpFilterSettings {
  const next = { ...getFilterSettings(), ...patch };
  db.prepare('INSERT INTO dhcp_settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run('filterSettings', JSON.stringify(next));
  return next;
}

// ───────────────────────────── scopes ─────────────────────────────
function rowToScope(r: Record<string, unknown>): DhcpScopeDef {
  return {
    id: String(r.id),
    name: String(r.name),
    description: (r.description as string) ?? undefined,
    state: r.state as DhcpScopeDef['state'],
    subnet: String(r.subnet),
    mask: String(r.mask),
    rangeStart: String(r.range_start),
    rangeEnd: String(r.range_end),
    leaseSeconds: Number(r.lease_seconds),
    dnsMode: ((r.dns_mode as string) ?? 'inherit') as DhcpScopeDef['dnsMode'],
    dnsServers: j<string[]>(r.dns_servers, []),
    options: j<DhcpOptionValue[]>(r.options, []),
  };
}
export function scopesAll(): DhcpScopeDef[] {
  return db.prepare('SELECT * FROM dhcp_scopes ORDER BY subnet').all().map(rowToScope);
}
export function scopeGet(id: string): DhcpScopeDef | undefined {
  const r = db.prepare('SELECT * FROM dhcp_scopes WHERE id = ?').get(id);
  return r ? rowToScope(r) : undefined;
}
export function scopeAdd(s: Omit<DhcpScopeDef, 'id'>): DhcpScopeDef {
  const id = rid('scope');
  db.prepare('INSERT INTO dhcp_scopes(id, name, description, state, subnet, mask, range_start, range_end, lease_seconds, dns_mode, dns_servers, options) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    id, s.name, s.description ?? null, s.state, s.subnet, s.mask, s.rangeStart, s.rangeEnd, s.leaseSeconds, s.dnsMode ?? 'inherit', JSON.stringify(s.dnsServers ?? []), JSON.stringify(s.options ?? []),
  );
  return scopeGet(id)!;
}
export function scopeUpdate(id: string, p: Partial<DhcpScopeDef>): void {
  const cur = scopeGet(id);
  if (!cur) return;
  const n = { ...cur, ...p };
  db.prepare('UPDATE dhcp_scopes SET name=?, description=?, state=?, subnet=?, mask=?, range_start=?, range_end=?, lease_seconds=?, dns_mode=?, dns_servers=?, options=? WHERE id=?').run(
    n.name, n.description ?? null, n.state, n.subnet, n.mask, n.rangeStart, n.rangeEnd, n.leaseSeconds, n.dnsMode ?? 'inherit', JSON.stringify(n.dnsServers ?? []), JSON.stringify(n.options), id,
  );
}
export function scopeDelete(id: string): void {
  db.prepare('DELETE FROM dhcp_exclusions WHERE scope_id = ?').run(id);
  db.prepare('DELETE FROM dhcp_reservations WHERE scope_id = ?').run(id);
  db.prepare('DELETE FROM dhcp_leases WHERE scope_id = ?').run(id);
  db.prepare('DELETE FROM dhcp_policies WHERE scope_id = ?').run(id);
  db.prepare('DELETE FROM dhcp_scopes WHERE id = ?').run(id);
}

// ───────────────────────────── exclusions ─────────────────────────────
export function exclusionsAll(scopeId?: string): DhcpExclusion[] {
  const rows = scopeId ? db.prepare('SELECT * FROM dhcp_exclusions WHERE scope_id = ?').all(scopeId) : db.prepare('SELECT * FROM dhcp_exclusions').all();
  return rows.map((r) => ({ id: String(r.id), scopeId: String(r.scope_id), start: String(r.start), end: String(r.end) }));
}
export function exclusionAdd(scopeId: string, start: string, end: string): DhcpExclusion {
  const id = rid('excl');
  db.prepare('INSERT INTO dhcp_exclusions(id, scope_id, start, end) VALUES(?, ?, ?, ?)').run(id, scopeId, start, end);
  return { id, scopeId, start, end };
}
export function exclusionDelete(id: string): void {
  db.prepare('DELETE FROM dhcp_exclusions WHERE id = ?').run(id);
}

// ───────────────────────────── reservations ─────────────────────────────
function rowToRes(r: Record<string, unknown>): DhcpReservation {
  return {
    id: String(r.id), scopeId: String(r.scope_id), ip: String(r.ip), mac: String(r.mac).toLowerCase(),
    name: (r.name as string) ?? undefined, description: (r.description as string) ?? undefined,
    supported: r.supported as DhcpReservation['supported'], options: j<DhcpOptionValue[]>(r.options, []),
  };
}
export function reservationsAll(scopeId?: string): DhcpReservation[] {
  const rows = scopeId ? db.prepare('SELECT * FROM dhcp_reservations WHERE scope_id = ?').all(scopeId) : db.prepare('SELECT * FROM dhcp_reservations').all();
  return rows.map(rowToRes);
}
export function reservationByMac(mac: string): DhcpReservation | undefined {
  const r = db.prepare('SELECT * FROM dhcp_reservations WHERE lower(mac) = ?').get(mac.toLowerCase());
  return r ? rowToRes(r) : undefined;
}
export function reservationAdd(res: Omit<DhcpReservation, 'id'>): DhcpReservation {
  const id = rid('res');
  db.prepare('INSERT INTO dhcp_reservations(id, scope_id, ip, mac, name, description, supported, options) VALUES(?, ?, ?, ?, ?, ?, ?, ?)').run(
    id, res.scopeId, res.ip, res.mac.toLowerCase(), res.name ?? null, res.description ?? null, res.supported ?? 'both', JSON.stringify(res.options ?? []),
  );
  return rowToRes(db.prepare('SELECT * FROM dhcp_reservations WHERE id = ?').get(id)!);
}
export function reservationDelete(id: string): void {
  db.prepare('DELETE FROM dhcp_reservations WHERE id = ?').run(id);
}

// ───────────────────────────── leases ─────────────────────────────
function rowToLease(r: Record<string, unknown>): DhcpLeaseInfo {
  return {
    id: String(r.id), scopeId: String(r.scope_id), ip: String(r.ip), mac: String(r.mac).toLowerCase(),
    hostname: (r.hostname as string) ?? undefined, vendor: (r.vendor as string) ?? undefined,
    state: r.state as DhcpLeaseInfo['state'], startedAt: String(r.started_at), expiresAt: String(r.expires_at),
    clientId: (r.client_id as string) ?? undefined,
  };
}
export function leasesAll(scopeId?: string): DhcpLeaseInfo[] {
  const rows = scopeId ? db.prepare('SELECT * FROM dhcp_leases WHERE scope_id = ? ORDER BY ip').all(scopeId) : db.prepare('SELECT * FROM dhcp_leases ORDER BY ip').all();
  return rows.map(rowToLease);
}
export function leaseByIp(ip: string): DhcpLeaseInfo | undefined {
  const r = db.prepare('SELECT * FROM dhcp_leases WHERE ip = ?').get(ip);
  return r ? rowToLease(r) : undefined;
}
export function leaseByMac(mac: string, scopeId: string): DhcpLeaseInfo | undefined {
  const r = db.prepare('SELECT * FROM dhcp_leases WHERE lower(mac) = ? AND scope_id = ?').get(mac.toLowerCase(), scopeId);
  return r ? rowToLease(r) : undefined;
}
export function leaseUpsert(l: DhcpLeaseInfo): void {
  db.prepare(`INSERT INTO dhcp_leases(id, scope_id, ip, mac, hostname, vendor, state, started_at, expires_at, client_id)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(ip) DO UPDATE SET scope_id=excluded.scope_id, mac=excluded.mac,
      hostname=COALESCE(excluded.hostname, hostname), vendor=COALESCE(excluded.vendor, vendor),
      state=excluded.state, started_at=excluded.started_at, expires_at=excluded.expires_at, client_id=excluded.client_id`).run(
    l.id, l.scopeId, l.ip, l.mac.toLowerCase(), l.hostname ?? null, l.vendor ?? null, l.state, l.startedAt, l.expiresAt, l.clientId ?? null,
  );
}
export function leaseDelete(ip: string): void {
  db.prepare('DELETE FROM dhcp_leases WHERE ip = ?').run(ip);
}
export function leaseSetState(ip: string, state: DhcpLeaseInfo['state']): void {
  db.prepare('UPDATE dhcp_leases SET state = ? WHERE ip = ?').run(state, ip);
}

// ───────────────────────────── filters ─────────────────────────────
export function filtersAll(): DhcpFilter[] {
  return db.prepare('SELECT * FROM dhcp_filters ORDER BY type, mac').all().map((r) => ({
    id: String(r.id), mac: String(r.mac).toLowerCase(), type: r.type as DhcpFilter['type'], description: (r.description as string) ?? undefined,
  }));
}
export function filterAdd(mac: string, type: DhcpFilter['type'], description?: string): DhcpFilter {
  const id = rid('filt');
  db.prepare('INSERT INTO dhcp_filters(id, mac, type, description) VALUES(?, ?, ?, ?)').run(id, mac.toLowerCase(), type, description ?? null);
  return { id, mac: mac.toLowerCase(), type, description };
}
export function filterDelete(id: string): void {
  db.prepare('DELETE FROM dhcp_filters WHERE id = ?').run(id);
}

// ───────────────────────────── policies ─────────────────────────────
function rowToPolicy(r: Record<string, unknown>): DhcpPolicy {
  return {
    id: String(r.id), scopeId: String(r.scope_id), name: String(r.name), enabled: r.enabled === 1,
    conditionType: r.condition_type as DhcpPolicy['conditionType'], conditionValue: String(r.condition_value),
    options: j<DhcpOptionValue[]>(r.options, []),
  };
}
export function policiesAll(scopeId?: string): DhcpPolicy[] {
  const rows = scopeId ? db.prepare('SELECT * FROM dhcp_policies WHERE scope_id = ?').all(scopeId) : db.prepare('SELECT * FROM dhcp_policies').all();
  return rows.map(rowToPolicy);
}
export function policyAdd(p: Omit<DhcpPolicy, 'id'>): DhcpPolicy {
  const id = rid('pol');
  db.prepare('INSERT INTO dhcp_policies(id, scope_id, name, enabled, condition_type, condition_value, options) VALUES(?, ?, ?, ?, ?, ?, ?)').run(
    id, p.scopeId, p.name, p.enabled ? 1 : 0, p.conditionType, p.conditionValue, JSON.stringify(p.options ?? []),
  );
  return rowToPolicy(db.prepare('SELECT * FROM dhcp_policies WHERE id = ?').get(id)!);
}
export function policyUpdate(id: string, p: Partial<DhcpPolicy>): void {
  const cur = policiesAll().find((x) => x.id === id);
  if (!cur) return;
  const n = { ...cur, ...p };
  db.prepare('UPDATE dhcp_policies SET name=?, enabled=?, condition_type=?, condition_value=?, options=? WHERE id=?').run(
    n.name, n.enabled ? 1 : 0, n.conditionType, n.conditionValue, JSON.stringify(n.options), id,
  );
}
export function policyDelete(id: string): void {
  db.prepare('DELETE FROM dhcp_policies WHERE id = ?').run(id);
}

// ───────────────────────────── seed ─────────────────────────────
function seed(): void {
  if (scopesAll().length > 0) return;
  const ip = detectLanIp();
  if (!ip) return;
  const base = ip.split('.').slice(0, 3).join('.');
  const gw = detectGateway() ?? `${base}.1`;
  scopeAdd({
    name: 'LAN',
    description: 'Example scope — edit the range/options, then enable the server after disabling the router DHCP',
    state: 'active',
    subnet: `${base}.0`,
    mask: '255.255.255.0',
    rangeStart: `${base}.100`,
    rangeEnd: `${base}.200`,
    leaseSeconds: 86400,
    dnsMode: 'inherit',
    dnsServers: [],
    options: [
      { code: 3, value: gw }, // router
      { code: 15, value: 'lan' }, // domain
    ],
  });
}
seed();

export { db, DB_PATH };

/** Delete non-active leases whose expiry is older than maxDays (0 = keep forever). Returns rows removed. */
export function pruneLeasesByAge(maxDays: number): number {
  if (maxDays <= 0) return 0;
  const cutoff = new Date(Date.now() - maxDays * 86400_000).toISOString();
  return Number(db.prepare("DELETE FROM dhcp_leases WHERE state != 'active' AND expires_at < ?").run(cutoff).changes);
}
