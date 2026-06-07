/**
 * Persistent store for the DNS resolver — Node's built-in SQLite (no native dep).
 * Holds settings, groups, block/allow domains, adlists + gravity, clients, and
 * the full query log. Runs under `node --experimental-sqlite`.
 */
import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import type {
  DnsAdlist,
  DnsClient,
  DnsGroup,
  DnsListDomain,
  DnsListMatch,
  DnsListType,
  DnsQuery,
  DnsResolverSettings,
  QueryStatus,
} from '@nexrelm/types';
import { STARTER_BLOCKLIST, DEFAULT_ADLISTS } from './presets';

const DATA_DIR = process.env.NEXRELM_DATA ?? path.join(os.homedir(), '.nexrelm');
const DB_PATH = process.env.NEXRELM_DNS_DB ?? path.join(DATA_DIR, 'dns.db');

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;');

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, comment TEXT
  );
  CREATE TABLE IF NOT EXISTS domains (
    id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, kind TEXT NOT NULL, domain TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1, comment TEXT, groups TEXT NOT NULL DEFAULT '[0]', hits INTEGER NOT NULL DEFAULT 0,
    date_added TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS adlists (
    id INTEGER PRIMARY KEY AUTOINCREMENT, url TEXT NOT NULL UNIQUE, enabled INTEGER NOT NULL DEFAULT 1, comment TEXT,
    count INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending', groups TEXT NOT NULL DEFAULT '[0]', updated_at TEXT
  );
  CREATE TABLE IF NOT EXISTS gravity (domain TEXT NOT NULL, adlist_id INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS idx_gravity_domain ON gravity(domain);
  CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT, ip TEXT NOT NULL UNIQUE, name TEXT, mac TEXT, vendor TEXT, iface TEXT,
    first_seen TEXT NOT NULL, last_seen TEXT NOT NULL, queries INTEGER NOT NULL DEFAULT 0, groups TEXT NOT NULL DEFAULT '[]'
  );
  CREATE TABLE IF NOT EXISTS queries (
    id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, client TEXT NOT NULL, client_name TEXT, domain TEXT NOT NULL,
    type TEXT NOT NULL, status TEXT NOT NULL, upstream TEXT, reply_ms REAL NOT NULL DEFAULT 0, reply TEXT, list_id INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_queries_ts ON queries(ts);
  CREATE INDEX IF NOT EXISTS idx_queries_domain ON queries(domain);
  CREATE INDEX IF NOT EXISTS idx_queries_client ON queries(client);
`);

// migrations (added after the initial schema shipped)
for (const stmt of [
  "ALTER TABLE adlists ADD COLUMN type TEXT NOT NULL DEFAULT 'block'",
  'ALTER TABLE adlists ADD COLUMN priority INTEGER NOT NULL DEFAULT 100',
  'ALTER TABLE domains ADD COLUMN priority INTEGER NOT NULL DEFAULT 1000',
  'ALTER TABLE clients ADD COLUMN nickname TEXT',
]) {
  try {
    db.exec(stmt);
  } catch {
    /* column already exists */
  }
}

// ───────────────────────────── helpers ─────────────────────────────
const b = (v: unknown): boolean => v === 1 || v === true || v === '1';
const i = (v: boolean): number => (v ? 1 : 0);
const jarr = (v: unknown): number[] => {
  try {
    const a = JSON.parse(String(v ?? '[]'));
    return Array.isArray(a) ? a.map(Number) : [];
  } catch {
    return [];
  }
};
const iso = (): string => new Date().toISOString();

/** Best-effort primary LAN IPv4 (skips loopback, docker, libvirt ranges). */
export function detectLanIp(): string | null {
  const ifaces = os.networkInterfaces();
  const cands: string[] = [];
  for (const [name, addrs] of Object.entries(ifaces)) {
    for (const a of addrs ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      if (/^(docker|br-|virbr|veth)/.test(name)) continue;
      if (/^(172\.1[6-9]\.|172\.2\d\.|172\.3[01]\.|192\.168\.122\.)/.test(a.address)) continue;
      cands.push(a.address);
    }
  }
  cands.sort((x, y) => (x.startsWith('192.168.') ? -1 : 0) - (y.startsWith('192.168.') ? -1 : 0));
  return cands[0] ?? null;
}

// ───────────────────────────── settings ─────────────────────────────
function defaultSettings(): DnsResolverSettings {
  return {
    upstreams: ['1.1.1.1', '1.0.0.1'],
    blockingMode: 'null',
    localDomain: 'lan',
    expandHostnames: true,
    rateLimitCount: 1000,
    rateLimitWindow: 60,
    bindAddress: process.env.DNS_BIND ?? detectLanIp() ?? '0.0.0.0',
    port: Number(process.env.DNS_PORT ?? 53),
    listenMode: 'local',
    iface: '',
    neverForwardNonFqdn: false,
    neverForwardReversePrivate: true,
    dnssec: false,
    ecs: false,
    condForwarding: [],
    logQueries: true,
    privacyLevel: 0,
    dbMaxDays: 91,
    ipMaxDays: 91,
  };
}

// ───────────────────────────── blocking state ─────────────────────────────
import type { BlockingState } from '@nexrelm/types';

export function getBlocking(): BlockingState {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('blocking');
  const stored = row ? (JSON.parse(String(row.value)) as BlockingState) : { enabled: true, disabledUntil: null };
  // auto-resume if the timed pause elapsed
  if (!stored.enabled && stored.disabledUntil && new Date(stored.disabledUntil).getTime() <= Date.now()) {
    return setBlocking({ enabled: true, disabledUntil: null });
  }
  return stored;
}

export function setBlocking(state: BlockingState): BlockingState {
  db.prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    'blocking',
    JSON.stringify(state),
  );
  return state;
}

/** Prune query + client rows older than the configured retention windows. Returns rows removed. */
export function pruneByAge(dbMaxDays: number, ipMaxDays: number): { queries: number; clients: number } {
  let queries = 0;
  let clients = 0;
  if (dbMaxDays > 0) {
    const cutoff = new Date(Date.now() - dbMaxDays * 86400_000).toISOString();
    queries = Number(db.prepare('DELETE FROM queries WHERE ts < ?').run(cutoff).changes);
  }
  if (ipMaxDays > 0) {
    const cutoff = new Date(Date.now() - ipMaxDays * 86400_000).toISOString();
    clients = Number(db.prepare('DELETE FROM clients WHERE last_seen < ?').run(cutoff).changes);
  }
  return { queries, clients };
}


export function getSettings(): DnsResolverSettings {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('resolver');
  const stored = row ? (JSON.parse(String(row.value)) as Partial<DnsResolverSettings>) : {};
  return { ...defaultSettings(), ...stored };
}

export function saveSettings(patch: Partial<DnsResolverSettings>): DnsResolverSettings {
  const next = { ...getSettings(), ...patch };
  db.prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    'resolver',
    JSON.stringify(next),
  );
  return next;
}

// ───────────────────────────── groups ─────────────────────────────
export function groupsAll(): DnsGroup[] {
  return db
    .prepare('SELECT * FROM groups ORDER BY id')
    .all()
    .map((r) => ({ id: Number(r.id), name: String(r.name), enabled: b(r.enabled), comment: (r.comment as string) ?? undefined }));
}
export function groupAdd(name: string, comment?: string): number {
  const r = db.prepare('INSERT INTO groups(name, enabled, comment) VALUES(?, 1, ?)').run(name, comment ?? null);
  return Number(r.lastInsertRowid);
}
export function groupUpdate(id: number, patch: Partial<DnsGroup>): void {
  const g = db.prepare('SELECT * FROM groups WHERE id = ?').get(id);
  if (!g) return;
  db.prepare('UPDATE groups SET name = ?, enabled = ?, comment = ? WHERE id = ?').run(
    patch.name ?? String(g.name),
    i(patch.enabled ?? b(g.enabled)),
    patch.comment ?? ((g.comment as string) ?? null),
    id,
  );
}
export function groupDelete(id: number): void {
  if (id === 0) return; // never delete Default
  db.prepare('DELETE FROM groups WHERE id = ?').run(id);
}

// ───────────────────────────── domains (block/allow) ─────────────────────────────
function rowToDomain(r: Record<string, unknown>): DnsListDomain {
  return {
    id: Number(r.id),
    type: r.type as DnsListType,
    kind: r.kind as DnsListDomain['kind'],
    domain: String(r.domain),
    enabled: b(r.enabled),
    comment: (r.comment as string) ?? undefined,
    groups: jarr(r.groups),
    priority: Number(r.priority ?? 1000),
    hits: Number(r.hits),
    dateAdded: String(r.date_added),
  };
}
export function domainsAll(type?: DnsListType): DnsListDomain[] {
  const rows = type
    ? db.prepare('SELECT * FROM domains WHERE type = ? ORDER BY id DESC').all(type)
    : db.prepare('SELECT * FROM domains ORDER BY id DESC').all();
  return rows.map(rowToDomain);
}
export function domainAdd(d: { type: DnsListType; kind: DnsListDomain['kind']; domain: string; comment?: string; groups?: number[] }): DnsListDomain {
  const r = db
    .prepare('INSERT INTO domains(type, kind, domain, enabled, comment, groups, hits, date_added) VALUES(?, ?, ?, 1, ?, ?, 0, ?)')
    .run(d.type, d.kind, d.domain.toLowerCase(), d.comment ?? null, JSON.stringify(d.groups ?? [0]), iso());
  return rowToDomain(db.prepare('SELECT * FROM domains WHERE id = ?').get(Number(r.lastInsertRowid))!);
}
export function domainUpdate(id: number, patch: Partial<DnsListDomain>): void {
  const r = db.prepare('SELECT * FROM domains WHERE id = ?').get(id);
  if (!r) return;
  const cur = rowToDomain(r);
  db.prepare('UPDATE domains SET enabled = ?, comment = ?, groups = ?, priority = ? WHERE id = ?').run(
    i(patch.enabled ?? cur.enabled),
    patch.comment ?? (cur.comment ?? null),
    JSON.stringify(patch.groups ?? cur.groups),
    patch.priority ?? cur.priority,
    id,
  );
}
export function domainDelete(id: number): void {
  db.prepare('DELETE FROM domains WHERE id = ?').run(id);
}
export function domainHit(id: number): void {
  db.prepare('UPDATE domains SET hits = hits + 1 WHERE id = ?').run(id);
}

// ───────────────────────────── adlists + gravity ─────────────────────────────
function rowToAdlist(r: Record<string, unknown>): DnsAdlist {
  return {
    id: Number(r.id),
    url: String(r.url),
    type: ((r.type as string) ?? 'block') as DnsListType,
    enabled: b(r.enabled),
    comment: (r.comment as string) ?? undefined,
    count: Number(r.count),
    status: r.status as DnsAdlist['status'],
    groups: jarr(r.groups),
    priority: Number(r.priority ?? 100),
    updatedAt: (r.updated_at as string) ?? undefined,
  };
}
export function adlistsAll(): DnsAdlist[] {
  return db.prepare('SELECT * FROM adlists ORDER BY priority DESC, id').all().map(rowToAdlist);
}
export function adlistAdd(url: string, comment?: string, groups: number[] = [0], type: DnsListType = 'block', priority = 100): DnsAdlist {
  const r = db
    .prepare("INSERT INTO adlists(url, type, enabled, comment, count, status, groups, priority) VALUES(?, ?, 1, ?, 0, 'pending', ?, ?)")
    .run(url, type, comment ?? null, JSON.stringify(groups), priority);
  return rowToAdlist(db.prepare('SELECT * FROM adlists WHERE id = ?').get(Number(r.lastInsertRowid))!);
}
export function adlistUpdate(id: number, patch: Partial<DnsAdlist>): void {
  const r = db.prepare('SELECT * FROM adlists WHERE id = ?').get(id);
  if (!r) return;
  const cur = rowToAdlist(r);
  db.prepare('UPDATE adlists SET enabled = ?, comment = ?, groups = ?, type = ?, priority = ? WHERE id = ?').run(
    i(patch.enabled ?? cur.enabled),
    patch.comment ?? (cur.comment ?? null),
    JSON.stringify(patch.groups ?? cur.groups),
    patch.type ?? cur.type,
    patch.priority ?? cur.priority,
    id,
  );
}
export function adlistDelete(id: number): void {
  db.prepare('DELETE FROM gravity WHERE adlist_id = ?').run(id);
  db.prepare('DELETE FROM adlists WHERE id = ?').run(id);
}
/** Replace all gravity domains for one adlist (used by a gravity rebuild). */
export function gravityReplace(adlistId: number, domains: string[]): number {
  // node:sqlite binds JS numbers as REAL, so adlist_id is inlined as an integer
  // literal (same fix class as the stats bucketing bug); the whole swap — delete,
  // re-insert, and the adlists metadata update — is one transaction so a crash
  // can't leave the list half-rebuilt.
  const id = adlistId | 0;
  const ins = db.prepare(`INSERT INTO gravity(domain, adlist_id) VALUES(?, ${id})`);
  db.exec('BEGIN');
  try {
    db.prepare(`DELETE FROM gravity WHERE adlist_id = ${id}`).run();
    for (const d of domains) ins.run(d);
    db.prepare(`UPDATE adlists SET count = ${domains.length | 0}, status = 'ok', updated_at = ? WHERE id = ${id}`).run(iso());
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return domains.length;
}
export function gravityTotal(): number {
  return Number(db.prepare('SELECT COUNT(*) AS n FROM gravity').get()?.n ?? 0);
}

// ───────────────────────────── clients ─────────────────────────────
function rowToClient(r: Record<string, unknown>): DnsClient {
  return {
    id: Number(r.id),
    ip: String(r.ip),
    name: (r.name as string) ?? undefined,
    mac: (r.mac as string) ?? undefined,
    vendor: (r.vendor as string) ?? undefined,
    interface: (r.iface as string) ?? undefined,
    firstSeen: String(r.first_seen),
    lastSeen: String(r.last_seen),
    queries: Number(r.queries),
    groups: jarr(r.groups),
    nickname: (r.nickname as string) ?? undefined,
  };
}
export function clientsAll(): DnsClient[] {
  return db.prepare('SELECT * FROM clients ORDER BY queries DESC, last_seen DESC').all().map(rowToClient);
}
export function clientGet(ip: string): DnsClient | undefined {
  const r = db.prepare('SELECT * FROM clients WHERE ip = ?').get(ip);
  return r ? rowToClient(r) : undefined;
}
/** Record a query against a client, creating + enriching the row as needed. */
export function clientTouch(ip: string, enrich: { name?: string; mac?: string; vendor?: string; iface?: string }): DnsClient {
  const now = iso();
  const existing = db.prepare('SELECT * FROM clients WHERE ip = ?').get(ip);
  if (!existing) {
    db.prepare('INSERT INTO clients(ip, name, mac, vendor, iface, first_seen, last_seen, queries, groups) VALUES(?, ?, ?, ?, ?, ?, ?, 1, ?)').run(
      ip,
      enrich.name ?? null,
      enrich.mac ?? null,
      enrich.vendor ?? null,
      enrich.iface ?? null,
      now,
      now,
      '[]',
    );
  } else {
    db.prepare('UPDATE clients SET last_seen = ?, queries = queries + 1, name = COALESCE(?, name), mac = COALESCE(?, mac), vendor = COALESCE(?, vendor), iface = COALESCE(?, iface) WHERE ip = ?').run(
      now,
      enrich.name ?? null,
      enrich.mac ?? null,
      enrich.vendor ?? null,
      enrich.iface ?? null,
      ip,
    );
  }
  return clientGet(ip)!;
}
export function clientGroupsSet(id: number, groups: number[]): void {
  db.prepare('UPDATE clients SET groups = ? WHERE id = ?').run(JSON.stringify(groups), id);
}
export function clientNicknameSet(id: number, nickname: string): void {
  db.prepare('UPDATE clients SET nickname = ? WHERE id = ?').run(nickname.trim() || null, id);
}
export function groupsForClientIp(ip: string): number[] {
  const c = clientGet(ip);
  const g = c?.groups ?? [];
  return g.length ? g : [0]; // unassigned clients are in the Default group
}

// ───────────────────────────── query log ─────────────────────────────
export function queryInsert(q: Omit<DnsQuery, 'id'>): void {
  db.prepare('INSERT INTO queries(ts, client, client_name, domain, type, status, upstream, reply_ms, reply, list_id) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    q.ts,
    q.client,
    q.clientName ?? null,
    q.domain,
    q.type,
    q.status,
    q.upstream ?? null,
    q.replyMs,
    q.reply ?? null,
    q.listId ?? null,
  );
}
export interface QueryFilter {
  limit?: number;
  offset?: number;
  domain?: string;
  client?: string;
  status?: QueryStatus;
}
export function queriesRecent(f: QueryFilter = {}): DnsQuery[] {
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (f.domain) { where.push('domain LIKE ?'); params.push(`%${f.domain}%`); }
  if (f.client) { where.push('(client LIKE ? OR client_name LIKE ?)'); params.push(`%${f.client}%`, `%${f.client}%`); }
  if (f.status) { where.push('status = ?'); params.push(f.status); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.min(f.limit ?? 200, 1000);
  const offset = f.offset ?? 0;
  const rows = db.prepare(`SELECT * FROM queries ${w} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
  return rows.map((r) => ({
    id: Number(r.id),
    ts: String(r.ts),
    client: String(r.client),
    clientName: (r.client_name as string) ?? undefined,
    domain: String(r.domain),
    type: String(r.type),
    status: r.status as QueryStatus,
    upstream: (r.upstream as string) ?? undefined,
    replyMs: Number(r.reply_ms),
    reply: (r.reply as string) ?? undefined,
    listId: r.list_id == null ? undefined : Number(r.list_id),
  }));
}

/** Trim the query log to the most recent N rows (keeps the DB bounded). */
export function queriesPrune(keep = 100_000): void {
  db.prepare('DELETE FROM queries WHERE id <= (SELECT MAX(id) - ? FROM queries)').run(keep);
}

// ───────────────────────────── search across lists ─────────────────────────────
export function domainSearch(q: string): DnsListMatch[] {
  const needle = q.toLowerCase();
  const out: DnsListMatch[] = [];
  // manual entries: exact contains, or regex whose pattern contains the text
  for (const d of domainsAll()) {
    if (d.domain.toLowerCase().includes(needle)) {
      out.push({ listId: d.id, type: d.type, kind: d.kind, domain: d.domain, enabled: d.enabled, groups: d.groups, source: 'manual' });
    }
  }
  // gravity (adlist) matches
  const grows = db.prepare('SELECT g.domain, g.adlist_id FROM gravity g WHERE g.domain LIKE ? LIMIT 100').all(`%${needle}%`);
  const adlistById = new Map(adlistsAll().map((a) => [a.id, a]));
  for (const r of grows) {
    const a = adlistById.get(Number(r.adlist_id));
    out.push({
      listId: Number(r.adlist_id),
      type: a?.type ?? 'block',
      kind: 'exact',
      domain: String(r.domain),
      enabled: a?.enabled ?? true,
      groups: a?.groups ?? [0],
      source: 'adlist',
      adlistUrl: a?.url,
    });
  }
  return out;
}

// ───────────────────────────── lookup data (for the in-memory compiler) ─────────────────────────────
export interface LookupRow {
  id: number;
  domain: string;
  kind: DnsListDomain['kind'];
  groups: number[];
  priority: number;
}
export function activeEntries(type: DnsListType): LookupRow[] {
  return db
    .prepare('SELECT id, domain, kind, groups, priority FROM domains WHERE type = ? AND enabled = 1')
    .all(type)
    .map((r) => ({ id: Number(r.id), domain: String(r.domain).toLowerCase(), kind: r.kind as DnsListDomain['kind'], groups: jarr(r.groups), priority: Number(r.priority ?? 1000) }));
}
export interface GravityEntry {
  domain: string;
  type: DnsListType;
  priority: number;
  groups: number[];
}
/** Every gravity entry tagged with its subscribed list's type/priority/groups. */
export function gravityEntries(): GravityEntry[] {
  const enabled = adlistsAll().filter((a) => a.enabled);
  const byList = new Map(enabled.map((a) => [a.id, a]));
  const rows = db.prepare('SELECT domain, adlist_id FROM gravity').all();
  const out: GravityEntry[] = [];
  for (const r of rows) {
    const a = byList.get(Number(r.adlist_id));
    if (!a) continue; // adlist disabled
    out.push({ domain: String(r.domain), type: a.type, priority: a.priority, groups: a.groups.length ? a.groups : [0] });
  }
  return out;
}

// ───────────────────────────── seed (first run) ─────────────────────────────
function seed(): void {
  const hasDefault = db.prepare('SELECT 1 FROM groups WHERE id = 0').get();
  if (!hasDefault) {
    db.prepare("INSERT INTO groups(id, name, enabled, comment) VALUES(0, 'Default', 1, 'Applies to every client not in another group')").run();
  }
  if (gravityTotal() === 0 && adlistsAll().length === 0) {
    // built-in starter adlist (id assigned) so blocking works offline immediately
    const starter = adlistAdd('builtin://starter-blocklist', 'Built-in starter blocklist', [0]);
    gravityReplace(starter.id, STARTER_BLOCKLIST);
    for (const url of DEFAULT_ADLISTS) adlistAdd(url, 'Public gravity source (run a gravity update to fetch)', [0]);
  }
  if (!db.prepare('SELECT 1 FROM settings WHERE key = ?').get('resolver')) {
    saveSettings({});
  }
}
seed();

export { db, DB_PATH, DATA_DIR };
