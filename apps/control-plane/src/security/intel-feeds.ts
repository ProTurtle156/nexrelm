/**
 * Threat-intelligence feeds — pulls public block/IOC lists (abuse.ch et al.) on a
 * schedule and keeps in-memory sets of known-bad IPs/domains. The heuristic engine
 * cross-references the live DNS stream + sniffer flows against these, so a client
 * contacting known-bad infrastructure is flagged even without a VirusTotal key.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { ThreatFeed, ThreatFeedState } from '@nexrelm/types';

const DATA_DIR = process.env.NEXRELM_DATA ?? path.join(os.homedir(), '.nexrelm');
const FILE = process.env.NEXRELM_FEEDS ?? path.join(DATA_DIR, 'security-feeds.json');

interface FeedDef {
  id: string;
  name: string;
  url: string;
  kind: 'ip' | 'domain';
}
const DEFAULTS: FeedDef[] = [
  { id: 'feodo', name: 'Feodo Tracker — botnet C2 IPs', url: 'https://feodotracker.abuse.ch/downloads/ipblocklist.txt', kind: 'ip' },
  { id: 'sslbl', name: 'SSLBL — malicious SSL/TLS IPs', url: 'https://sslbl.abuse.ch/blacklist/sslipblacklist.txt', kind: 'ip' },
  { id: 'blocklistde', name: 'blocklist.de — attacking IPs', url: 'https://lists.blocklist.de/lists/all.txt', kind: 'ip' },
  { id: 'cins', name: 'CINS Army — poor-reputation IPs', url: 'https://cinsscore.com/list/ci-badguys.txt', kind: 'ip' },
  { id: 'et-compromised', name: 'Emerging Threats — compromised hosts', url: 'https://rules.emergingthreats.net/blockrules/compromised-ips.txt', kind: 'ip' },
  { id: 'urlhaus', name: 'URLhaus — malware-distribution domains', url: 'https://urlhaus.abuse.ch/downloads/hostfile/', kind: 'domain' },
  { id: 'threatfox', name: 'ThreatFox — recent IOC domains', url: 'https://threatfox.abuse.ch/downloads/hostfile/', kind: 'domain' },
  { id: 'phishing-army', name: 'Phishing Army — phishing domains', url: 'https://phishing.army/download/phishing_army_blocklist.txt', kind: 'domain' },
];

const meta = new Map<string, { enabled: boolean; entries: number; lastFetch?: string; error?: string }>();
const ipSet = new Set<string>();
const domSet = new Set<string>();
let lastRefresh: string | undefined;
let started = false;

function loadCfg(): void {
  let cfg: Record<string, { enabled: boolean }> = {};
  try {
    cfg = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    /* defaults all on */
  }
  for (const f of DEFAULTS) meta.set(f.id, { enabled: cfg[f.id]?.enabled ?? true, entries: 0 });
}
function persist(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const cfg: Record<string, { enabled: boolean }> = {};
  for (const [id, m] of meta) cfg[id] = { enabled: m.enabled };
  fs.writeFileSync(FILE, JSON.stringify(cfg, null, 2));
}

const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/;
function parseFeed(text: string, kind: 'ip' | 'domain'): string[] {
  const out: string[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (kind === 'ip') {
      const ip = line.split(/\s+/)[0]!;
      if (IPV4.test(ip)) out.push(ip);
    } else {
      const parts = line.split(/\s+/);
      const dom = (parts.length >= 2 ? parts[1] : parts[0])!.toLowerCase();
      if (/^([a-z0-9_-]+\.)+[a-z]{2,}$/i.test(dom) && dom !== 'localhost') out.push(dom);
    }
  }
  return out;
}

export async function refreshFeeds(): Promise<ThreatFeedState> {
  if (!meta.size) loadCfg();
  ipSet.clear();
  domSet.clear();
  for (const f of DEFAULTS) {
    const m = meta.get(f.id)!;
    if (!m.enabled) {
      m.entries = 0;
      continue;
    }
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 15_000);
      const res = await fetch(f.url, { signal: ctrl.signal, headers: { 'user-agent': 'Nexrelm/1.0' } });
      clearTimeout(to);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const items = parseFeed(await res.text(), f.kind);
      for (const i of items) (f.kind === 'ip' ? ipSet : domSet).add(i);
      m.entries = items.length;
      m.lastFetch = new Date().toISOString();
      m.error = undefined;
    } catch (e) {
      m.error = e instanceof Error ? e.message : 'fetch failed';
    }
  }
  lastRefresh = new Date().toISOString();
  return feedState();
}

export function startFeeds(): void {
  if (started) return;
  started = true;
  loadCfg();
  void refreshFeeds();
  setInterval(() => void refreshFeeds(), 6 * 60 * 60 * 1000); // every 6h
}

export function setFeedEnabled(id: string, enabled: boolean): ThreatFeedState {
  if (!meta.size) loadCfg();
  const m = meta.get(id);
  if (m) {
    m.enabled = enabled;
    persist();
  }
  return feedState();
}

export function badIps(): Set<string> {
  return ipSet;
}
export function badDomains(): Set<string> {
  return domSet;
}

export function feedState(): ThreatFeedState {
  const feeds: ThreatFeed[] = DEFAULTS.map((f) => {
    const m = meta.get(f.id) ?? { enabled: true, entries: 0 };
    return { id: f.id, name: f.name, url: f.url, kind: f.kind, enabled: m.enabled, entries: m.entries, lastFetch: m.lastFetch, error: m.error };
  });
  return { feeds, totalIndicators: ipSet.size + domSet.size, lastRefresh };
}
