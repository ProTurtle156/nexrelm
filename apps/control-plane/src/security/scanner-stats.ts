/**
 * Pull vulnerability statistics from external scanners (Nessus, Wazuh) so the
 * operator sees per-network/device vuln breakdowns alongside Nexrelm's own
 * nmap posture. Internal scanners usually use self-signed TLS, so we use a
 * node http(s) client with cert verification relaxed (these are operator-
 * configured internal endpoints). Best-effort: returns ok:false with the error
 * when the API/credentials/version don't line up.
 */
import http from 'node:http';
import https from 'node:https';
import type { ScannerStats, ScannerVuln, SecSeverity } from '@nexrelm/types';
import { scannerCreds } from './threat';

interface Resp {
  status: number;
  body: string;
}
function request(method: string, url: string, headers: Record<string, string>, payload?: string): Promise<Resp> {
  return new Promise((resolve, reject) => {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return reject(new Error('invalid URL'));
    }
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request(u, { method, headers, timeout: 8000, rejectUnauthorized: false } as https.RequestOptions, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timed out')));
    if (payload) req.write(payload);
    req.end();
  });
}

const NESSUS_SEV: SecSeverity[] = ['info', 'low', 'medium', 'high', 'critical']; // index 0..4

async function nessus(url: string, token: string): Promise<ScannerStats> {
  const [accessKey, secretKey] = token.includes(':') ? token.split(':') : [token, token];
  const headers = { 'X-ApiKeys': `accessKey=${accessKey}; secretKey=${secretKey}`, accept: 'application/json' };
  const base = url.replace(/\/$/, '');
  const list = await request('GET', `${base}/scans`, headers);
  if (list.status === 401 || list.status === 403) throw new Error('Nessus auth failed — check accessKey:secretKey');
  const scans = (JSON.parse(list.body).scans ?? []) as Array<{ id: number; name: string; last_modification_date?: number }>;
  if (!scans.length) return { kind: 'nessus', ok: true, fetchedAt: new Date().toISOString(), severityCounts: {}, totals: [{ label: 'scans', value: 0 }], top: [] };
  const latest = [...scans].sort((a, b) => (b.last_modification_date ?? 0) - (a.last_modification_date ?? 0))[0]!;
  const det = await request('GET', `${base}/scans/${latest.id}`, headers);
  const j = JSON.parse(det.body) as { vulnerabilities?: Array<{ plugin_name: string; severity: number; count: number }>; hosts?: unknown[] };
  const sev: Record<string, number> = {};
  const top: ScannerVuln[] = [];
  for (const v of j.vulnerabilities ?? []) {
    const s = NESSUS_SEV[v.severity] ?? 'info';
    sev[s] = (sev[s] ?? 0) + v.count;
    if (v.severity >= 3) top.push({ name: v.plugin_name, severity: s, count: v.count });
  }
  top.sort((a, b) => (b.count ?? 0) - (a.count ?? 0));
  return { kind: 'nessus', ok: true, fetchedAt: new Date().toISOString(), severityCounts: sev, totals: [{ label: 'scans', value: scans.length }, { label: 'hosts', value: (j.hosts ?? []).length }], top: top.slice(0, 12) };
}

async function wazuh(url: string, token: string): Promise<ScannerStats> {
  const base = url.replace(/\/$/, '');
  const [user, pass] = token.includes(':') ? token.split(':') : ['wazuh', token];
  const auth = await request('POST', `${base}/security/user/authenticate`, { authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}` });
  if (auth.status >= 400) throw new Error(`Wazuh auth failed (${auth.status}) — check user:password`);
  const jwt = JSON.parse(auth.body)?.data?.token;
  if (!jwt) throw new Error('Wazuh did not return a token');
  const h = { authorization: `Bearer ${jwt}`, accept: 'application/json' };
  const agents = await request('GET', `${base}/agents/summary/status`, h);
  const a = JSON.parse(agents.body)?.data ?? {};
  const totals = [
    { label: 'agents', value: a.total ?? 0 },
    { label: 'active', value: a.active ?? a.connected ?? 0 },
    { label: 'disconnected', value: a.disconnected ?? 0 },
  ];
  // best-effort vulnerability severity summary (endpoint varies by version)
  const sev: Record<string, number> = {};
  const top: ScannerVuln[] = [];
  try {
    const vuln = await request('GET', `${base}/vulnerability?limit=500`, h);
    const items = (JSON.parse(vuln.body)?.data?.affected_items ?? []) as Array<{ severity?: string; title?: string; name?: string }>;
    for (const it of items) {
      const s = (it.severity ?? 'info').toLowerCase();
      sev[s] = (sev[s] ?? 0) + 1;
      if (s === 'high' || s === 'critical') top.push({ name: it.title ?? it.name ?? 'CVE', severity: s as SecSeverity });
    }
  } catch {
    /* vulnerability endpoint not available on this version — agents still returned */
  }
  return { kind: 'wazuh', ok: true, fetchedAt: new Date().toISOString(), severityCounts: sev, totals, top: top.slice(0, 12) };
}

export async function scannerStats(kind: 'nessus' | 'wazuh'): Promise<ScannerStats> {
  const creds = scannerCreds(kind);
  const fail = (error: string): ScannerStats => ({ kind, ok: false, error, fetchedAt: new Date().toISOString(), severityCounts: {}, totals: [], top: [] });
  if (!creds) return fail('not configured');
  if (!creds.token) return fail('no API token saved — reconnect with a token');
  try {
    return kind === 'nessus' ? await nessus(creds.url, creds.token) : await wazuh(creds.url, creds.token);
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'fetch failed');
  }
}
