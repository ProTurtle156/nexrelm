/**
 * Security persistence — a small SQLite store (~/.nexrelm/security.db) shared by
 * the event history/timeline, the device registry (new-device detection), and
 * the anomaly baseline. Mirrors the dns/db.ts pattern (node:sqlite, WAL). Kept
 * separate from the DNS db so the two modules stay decoupled.
 */
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const DATA_DIR = process.env.NEXRELM_DATA ?? path.join(os.homedir(), '.nexrelm');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'security.db');

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
db.exec(`
  CREATE TABLE IF NOT EXISTS sec_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, kind TEXT NOT NULL, severity TEXT NOT NULL,
    source TEXT NOT NULL, title TEXT NOT NULL, detail TEXT NOT NULL, evidence TEXT, mitre_id TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
  CREATE INDEX IF NOT EXISTS idx_events_kind ON events(kind);
  CREATE TABLE IF NOT EXISTS devices (
    mac TEXT PRIMARY KEY, ip TEXT, name TEXT, vendor TEXT, os TEXT, trust TEXT NOT NULL DEFAULT 'pending',
    first_seen TEXT NOT NULL, last_seen TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS baseline (
    client TEXT NOT NULL, metric TEXT NOT NULL, mean REAL NOT NULL DEFAULT 0, m2 REAL NOT NULL DEFAULT 0,
    n INTEGER NOT NULL DEFAULT 0, updated TEXT, PRIMARY KEY (client, metric)
  );
`);

export function getSetting(key: string): string | undefined {
  const r = db.prepare('SELECT value FROM sec_settings WHERE key = ?').get(key);
  return r ? String(r.value) : undefined;
}
export function setSetting(key: string, value: string): void {
  db.prepare('INSERT INTO sec_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value);
}

/** Delete security events older than maxDays (0 = keep forever). Returns rows removed. */
export function pruneEventsByAge(maxDays: number): number {
  if (maxDays <= 0) return 0;
  const cutoff = new Date(Date.now() - maxDays * 86400_000).toISOString();
  return Number(db.prepare('DELETE FROM events WHERE ts < ?').run(cutoff).changes);
}
