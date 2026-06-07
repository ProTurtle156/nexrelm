/**
 * Vulnerability intelligence for the scanner — turns nmap's service/version + OS
 * fingerprints into "this is deprecated / end-of-life and therefore unpatched"
 * findings, using **endoflife.date** (free, open-source, no API key). Running
 * past-EOL software is the vulnerability: no security updates ship for it. The
 * dataset is cached to disk and refreshable on demand.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { SecSeverity, VulnIntelState } from '@nexrelm/types';

const DATA_DIR = process.env.NEXRELM_DATA ?? path.join(os.homedir(), '.nexrelm');
const FILE = path.join(DATA_DIR, 'vuln-intel.json');

// endoflife.date slugs we track (services + OSs). 404s are tolerated + reported.
// NB: endoflife.date has no openssh/samba entries — those stay covered by NSE vuln scripts.
const PRODUCTS = [
  'apache-http-server', 'nginx', 'tomcat', 'openssl', 'php', 'mysql', 'mariadb', 'postgresql',
  'python', 'nodejs', 'redis', 'mongodb', 'exim', 'postfix', 'dovecot', 'proftpd', 'haproxy', 'squid',
  'windows', 'windows-server', 'ubuntu', 'debian', 'centos', 'rhel', 'fedora',
  'macos', 'android', 'alpine', 'amazon-linux',
];

// map an nmap product/service banner → slug
const SVC_ALIAS: Array<{ re: RegExp; slug: string }> = [
  { re: /apache(?! tomcat)|httpd/i, slug: 'apache-http-server' },
  { re: /tomcat/i, slug: 'tomcat' },
  { re: /nginx/i, slug: 'nginx' },
  { re: /openssl/i, slug: 'openssl' },
  { re: /\bphp\b/i, slug: 'php' },
  { re: /mariadb/i, slug: 'mariadb' },
  { re: /mysql/i, slug: 'mysql' },
  { re: /postgre/i, slug: 'postgresql' },
  { re: /\bredis\b/i, slug: 'redis' },
  { re: /mongo/i, slug: 'mongodb' },
  { re: /exim/i, slug: 'exim' },
  { re: /postfix/i, slug: 'postfix' },
  { re: /dovecot/i, slug: 'dovecot' },
  { re: /proftpd/i, slug: 'proftpd' },
  { re: /haproxy/i, slug: 'haproxy' },
  { re: /squid/i, slug: 'squid' },
];

// map an nmap OS fingerprint → slug
const OS_ALIAS: Array<{ re: RegExp; slug: string }> = [
  { re: /windows server/i, slug: 'windows-server' },
  { re: /windows/i, slug: 'windows' },
  { re: /ubuntu/i, slug: 'ubuntu' },
  { re: /debian/i, slug: 'debian' },
  { re: /cent\s?os/i, slug: 'centos' },
  { re: /red ?hat|rhel/i, slug: 'rhel' },
  { re: /fedora/i, slug: 'fedora' },
  { re: /mac ?os|os x|darwin/i, slug: 'macos' },
  { re: /android/i, slug: 'android' },
  { re: /alpine/i, slug: 'alpine' },
];

interface Cycle {
  cycle: string;
  eol: string | boolean;
  latest?: string;
}

let intel: Record<string, Cycle[]> = {};
let meta: { lastRefresh?: string; perSource: Record<string, { entries: number; error?: string }> } = { perSource: {} };
let refreshing = false;

(function load(): void {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8')) as { intel: Record<string, Cycle[]>; meta: typeof meta };
    intel = raw.intel ?? {};
    meta = raw.meta ?? { perSource: {} };
  } catch {
    /* no cache yet */
  }
})();

function persist(): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify({ intel, meta }, null, 0));
  } catch {
    /* best effort */
  }
}

export async function refreshVulnIntel(): Promise<VulnIntelState> {
  if (refreshing) return vulnIntelState();
  refreshing = true;
  const next: Record<string, Cycle[]> = {};
  const per: Record<string, { entries: number; error?: string }> = {};
  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

  const fetchOne = async (slug: string): Promise<void> => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 8000);
        const res = await fetch(`https://endoflife.date/api/${slug}.json`, { signal: ctrl.signal, headers: { accept: 'application/json', 'user-agent': 'Nexrelm-vuln-intel/1.0' } });
        clearTimeout(t);
        if (!res.ok) {
          if ((res.status === 403 || res.status === 429) && attempt === 0) {
            await sleep(700);
            continue; // throttled — back off and retry once
          }
          per[slug] = { entries: 0, error: `HTTP ${res.status}` };
          return;
        }
        const arr = (await res.json()) as Array<Record<string, unknown>>;
        next[slug] = arr.map((c) => ({ cycle: String(c.cycle), eol: (c.eol as string | boolean) ?? false, latest: c.latest ? String(c.latest) : undefined }));
        per[slug] = { entries: next[slug].length };
        return;
      } catch (e) {
        if (attempt === 0) {
          await sleep(400);
          continue;
        }
        per[slug] = { entries: 0, error: e instanceof Error ? e.message.slice(0, 60) : 'fetch failed' };
      }
    }
  };

  // throttle into small batches so endoflife.date doesn't rate-limit the burst
  const CHUNK = 4;
  for (let i = 0; i < PRODUCTS.length; i += CHUNK) {
    await Promise.all(PRODUCTS.slice(i, i + CHUNK).map(fetchOne));
    if (i + CHUNK < PRODUCTS.length) await sleep(350);
  }
  // keep previously-cached products that failed this round, but only current slugs
  const merged = { ...intel, ...next };
  intel = {};
  for (const slug of PRODUCTS) if (merged[slug]?.length) intel[slug] = merged[slug];
  meta = { lastRefresh: new Date().toISOString(), perSource: per };
  refreshing = false;
  persist();
  return vulnIntelState();
}

/** Kick a background refresh on boot if we have no cached data. */
export function startVulnIntel(): void {
  if (Object.keys(intel).length === 0) void refreshVulnIntel().catch(() => undefined);
  // monthly refresh
  setInterval(() => void refreshVulnIntel().catch(() => undefined), 30 * 24 * 3600_000);
}

function findCycle(slug: string, version: string): Cycle | undefined {
  const cycles = intel[slug];
  if (!cycles) return undefined;
  const ver = version.match(/\d+(?:\.\d+)*/)?.[0];
  if (!ver) return undefined;
  let best: Cycle | undefined;
  for (const c of cycles) {
    if (ver === c.cycle || ver.startsWith(`${c.cycle}.`)) {
      if (!best || c.cycle.length > best.cycle.length) best = c;
    }
  }
  return best;
}

function eolStatus(c: Cycle): { eol: boolean; since?: string } {
  if (c.eol === true) return { eol: true };
  if (!c.eol) return { eol: false }; // boolean false or empty ⇒ still supported
  const ts = new Date(c.eol).getTime();
  return { eol: Number.isFinite(ts) && ts < Date.now(), since: String(c.eol) };
}

function severityForAge(since?: string): SecSeverity {
  if (!since) return 'high';
  const years = (Date.now() - new Date(since).getTime()) / (365 * 86400_000);
  return years > 4 ? 'critical' : years > 1 ? 'high' : 'medium';
}

export interface VulnHit {
  product: string;
  version: string;
  eolSince?: string;
  latest?: string;
  severity: SecSeverity;
}

export function vulnForService(product?: string, service?: string, version?: string): VulnHit | undefined {
  if (!version) return undefined;
  const a = SVC_ALIAS.find((x) => x.re.test(`${product ?? ''} ${service ?? ''}`));
  if (!a) return undefined;
  const c = findCycle(a.slug, version);
  if (!c) return undefined;
  const { eol, since } = eolStatus(c);
  if (!eol) return undefined;
  return { product: product || service || a.slug, version, eolSince: since, latest: c.latest, severity: severityForAge(since) };
}

export function vulnForOs(osString?: string): VulnHit | undefined {
  if (!osString) return undefined;
  const a = OS_ALIAS.find((x) => x.re.test(osString));
  if (!a) return undefined;
  const ver = osString.match(/\d+(?:\.\d+)*/)?.[0];
  if (!ver) return undefined;
  const c = findCycle(a.slug, ver);
  if (!c) return undefined;
  const { eol, since } = eolStatus(c);
  if (!eol) return undefined;
  return { product: osString.replace(/\s*\(\d+%\)\s*$/, ''), version: ver, eolSince: since, latest: c.latest, severity: severityForAge(since) };
}

export function vulnIntelState(): VulnIntelState {
  const sources = PRODUCTS.map((slug) => ({ name: slug, entries: intel[slug]?.length ?? 0, error: meta.perSource[slug]?.error }));
  return {
    provider: 'endoflife.date',
    lastRefresh: meta.lastRefresh,
    refreshing,
    products: PRODUCTS.length,
    loaded: Object.values(intel).filter((c) => c.length > 0).length,
    total: Object.values(intel).reduce((a, c) => a + c.length, 0),
    sources,
  };
}
