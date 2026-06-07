/**
 * Threat intelligence: VirusTotal v3 lookups for domains/IPs/hashes/URLs, plus
 * connect-to-configure for external scanners (Nessus, Wazuh). All API keys and
 * tokens are encrypted at rest with the secret vault.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { ScannerConnection, SecuritySettings, ThreatLookup, ThreatVendor } from '@nexrelm/types';
import { encryptSecret, decryptSecret } from './vault';
import { heuristicsOn } from './state';
import { tuningConfig } from './tuning';

const DATA_DIR = process.env.NEXRELM_DATA ?? path.join(os.homedir(), '.nexrelm');
const FILE = process.env.NEXRELM_SEC_SETTINGS ?? path.join(DATA_DIR, 'security-settings.json');

interface ScannerCfg {
  url?: string;
  tokenEnc?: string;
  lastChecked?: string;
  reachable?: boolean;
}
interface SecStore {
  vtKeyEnc?: string;
  nessus?: ScannerCfg;
  wazuh?: ScannerCfg;
}

let cache: SecStore | null = null;
function load(): SecStore {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(FILE, 'utf8')) as SecStore;
  } catch {
    cache = {};
  }
  return cache;
}
function persist(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(cache ?? {}, null, 2), { mode: 0o600 });
}

export function setVtKey(key: string): void {
  load().vtKeyEnc = key ? encryptSecret(key) : undefined;
  persist();
}
function vtKey(): string | null {
  const enc = load().vtKeyEnc;
  return enc ? decryptSecret(enc) : null;
}

function scannerConn(kind: 'nessus' | 'wazuh'): ScannerConnection {
  const c = load()[kind];
  return { kind, configured: !!c?.url, url: c?.url, reachable: c?.reachable, lastChecked: c?.lastChecked };
}

export function securitySettings(): SecuritySettings {
  return { virusTotalConfigured: !!vtKey(), heuristicsEnabled: heuristicsOn(), tuning: tuningConfig(), nessus: scannerConn('nessus'), wazuh: scannerConn('wazuh') };
}

export function scannerCreds(kind: 'nessus' | 'wazuh'): { url: string; token: string } | null {
  const c = load()[kind];
  if (!c?.url) return null;
  const token = c.tokenEnc ? (decryptSecret(c.tokenEnc) ?? '') : '';
  return { url: c.url, token };
}

export async function connectScanner(kind: 'nessus' | 'wazuh', url: string, token: string): Promise<ScannerConnection> {
  const store = load();
  store[kind] = { url: url.trim(), tokenEnc: token ? encryptSecret(token) : store[kind]?.tokenEnc, lastChecked: new Date().toISOString() };
  // best-effort reachability probe (self-signed certs may fail — that's noted, not fatal)
  let reachable = false;
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(url.trim(), { signal: ctrl.signal }).catch(() => null);
    clearTimeout(to);
    reachable = !!res; // any HTTP response (even 401) means it's up
  } catch {
    reachable = false;
  }
  store[kind]!.reachable = reachable;
  persist();
  return scannerConn(kind);
}

function indicatorKind(s: string): ThreatLookup['kind'] {
  if (/^https?:\/\//i.test(s)) return 'url';
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(s)) return 'ip';
  if (/^[a-f0-9]{32}$|^[a-f0-9]{40}$|^[a-f0-9]{64}$/i.test(s)) return 'hash';
  return 'domain';
}

export async function lookupIndicator(indicator: string): Promise<ThreatLookup> {
  const ind = indicator.trim();
  const kind = indicatorKind(ind);
  const base: ThreatLookup = { indicator: ind, kind, malicious: 0, suspicious: 0, harmless: 0, undetected: 0, verdict: 'unknown', checkedAt: new Date().toISOString() };
  const key = vtKey();
  if (!key) return { ...base, error: 'VirusTotal API key not configured (Settings → add key).' };

  const id = kind === 'url' ? Buffer.from(ind).toString('base64url').replace(/=+$/, '') : ind;
  const seg = kind === 'ip' ? 'ip_addresses' : kind === 'hash' ? 'files' : kind === 'url' ? 'urls' : 'domains';
  try {
    const res = await fetch(`https://www.virustotal.com/api/v3/${seg}/${encodeURIComponent(id)}`, { headers: { 'x-apikey': key } });
    if (res.status === 404) return { ...base, verdict: 'unknown', error: 'not found in VirusTotal' };
    if (!res.ok) return { ...base, error: `VirusTotal error ${res.status}` };
    const j = (await res.json()) as { data?: { attributes?: Record<string, unknown> } };
    const attr = j.data?.attributes ?? {};
    const stats = (attr.last_analysis_stats ?? {}) as Record<string, number>;
    const malicious = stats.malicious ?? 0;
    const suspicious = stats.suspicious ?? 0;
    const harmless = stats.harmless ?? 0;
    const undetected = stats.undetected ?? 0;
    const results = (attr.last_analysis_results ?? {}) as Record<string, { engine_name?: string; category?: string; result?: string }>;
    const vendors: ThreatVendor[] = Object.values(results)
      .filter((r) => r.category === 'malicious' || r.category === 'suspicious')
      .slice(0, 12)
      .map((r) => ({ engine: r.engine_name ?? '?', category: r.category ?? '', result: r.result ?? '' }));
    const verdict: ThreatLookup['verdict'] = malicious >= 3 ? 'malicious' : malicious + suspicious > 0 ? 'suspicious' : harmless + undetected > 0 ? 'clean' : 'unknown';
    return { ...base, malicious, suspicious, harmless, undetected, reputation: (attr.reputation as number) ?? undefined, verdict, vendors };
  } catch (e) {
    return { ...base, error: e instanceof Error ? e.message : 'lookup failed' };
  }
}
