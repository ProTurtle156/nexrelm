/**
 * Real vulnerability/exposure scanning via nmap. Uses service/version + OS
 * fingerprinting + ICMP ping (`-sV -O -PE`); these need raw-socket capability,
 * granted once with `setcap cap_net_raw,cap_net_admin+eip $(command -v nmap)`.
 * Without it we fall back to an unprivileged connect scan. nmap output is
 * streamed live (verbose) and parsed from XML so we capture the OS match.
 * Targets are strictly validated and passed as argv (never a shell).
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { PostureFinding, PostureReport, ScanHost, ScanProfileInfo, ScanRequest, ScanResult, ScanSchedule, ScanService, SecSeverity } from '@nexrelm/types';
import { vulnForService, vulnForOs } from './vuln-intel';
import { pushLog } from '../core/logbus';

const DATA_DIR = process.env.NEXRELM_DATA ?? path.join(os.homedir(), '.nexrelm');
const SCHED_FILE = process.env.NEXRELM_SCAN_SCHED ?? path.join(DATA_DIR, 'security-scan.json');
const TARGET_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*(\/\d{1,2})?$/;

let lastScan: ScanResult | null = null;
let running = false;
let currentProc: ChildProcess | null = null;
let cancelled = false;
let verboseMode = false;
let heartbeat: ReturnType<typeof setInterval> | null = null;

function stopHeartbeat(): void {
  if (heartbeat) {
    clearInterval(heartbeat);
    heartbeat = null;
  }
}

export function currentScan(): ScanResult | null {
  return lastScan;
}

/** Cancel a running scan (kills the nmap process). */
export function cancelScan(): ScanResult | null {
  cancelled = true;
  stopHeartbeat();
  if (currentProc) {
    try {
      currentProc.kill('SIGKILL'); // nmap can ride out a single SIGTERM mid-scan
    } catch {
      /* gone */
    }
    currentProc = null;
  }
  running = false;
  if (lastScan?.running) {
    lastScan = { ...lastScan, running: false, finishedAt: new Date().toISOString(), error: 'cancelled', log: [...(lastScan.log ?? []), '✖ scan cancelled by operator'] };
  }
  return lastScan;
}

interface RiskRule {
  re: RegExp;
  sev: SecSeverity;
  why: string;
  rec: string;
}
const RISKS: RiskRule[] = [
  { re: /\b(23)\b|telnet/i, sev: 'critical', why: 'Telnet is cleartext and trivially sniffed/hijacked.', rec: 'Disable telnet; use SSH.' },
  { re: /\b(21)\b|\bftp\b/i, sev: 'high', why: 'FTP sends credentials in cleartext.', rec: 'Replace with SFTP/FTPS or disable.' },
  { re: /\b(445|139)\b|microsoft-ds|netbios/i, sev: 'high', why: 'SMB exposed — common ransomware/lateral-movement vector.', rec: 'Restrict SMB to LAN; patch; disable SMBv1.' },
  { re: /\b(3389)\b|ms-wbt|rdp/i, sev: 'high', why: 'RDP exposed — brute-force and exploit target.', rec: 'Put RDP behind VPN; enable NLA + MFA.' },
  { re: /\b(5900|5901)\b|vnc/i, sev: 'high', why: 'VNC often weak/unencrypted.', rec: 'Tunnel over SSH/VPN; strong auth.' },
  { re: /\b(3306|5432|1433|27017|6379|9200|11211|5984)\b|mysql|postgres|mssql|mongo|redis|elastic|memcache/i, sev: 'high', why: 'A database/cache is reachable on the network.', rec: 'Bind to localhost or firewall to app hosts; require auth.' },
  { re: /\b(161|162)\b|snmp/i, sev: 'medium', why: 'SNMP can leak device internals (esp. v1/v2c).', rec: 'Use SNMPv3 or disable; restrict source.' },
  { re: /\b(111|2049)\b|rpcbind|nfs/i, sev: 'medium', why: 'RPC/NFS exposed — info disclosure / mount abuse.', rec: 'Restrict to trusted hosts or disable.' },
  { re: /\b(8080|8443|8000)\b/i, sev: 'low', why: 'Alternate HTTP admin port exposed.', rec: 'Confirm it should be reachable; add auth/TLS.' },
];

function classify(svc: ScanService): SecSeverity | undefined {
  const hay = `${svc.port} ${svc.service ?? ''} ${svc.product ?? ''}`;
  for (const r of RISKS) if (r.re.test(hay)) return r.sev;
  return undefined;
}

const attr = (s: string, name: string): string | undefined => s.match(new RegExp(`${name}="([^"]*)"`))?.[1];

function parseXml(xml: string): { hosts: ScanHost[]; osSeen: boolean } {
  const hosts: ScanHost[] = [];
  let osSeen = false;
  for (const block of xml.match(/<host\b[\s\S]*?<\/host>/g) ?? []) {
    const ip = block.match(/<address addr="([^"]+)" addrtype="ipv4"/)?.[1];
    if (!ip) continue;
    const up = /<status state="up"/.test(block);
    const host: ScanHost = { host: ip, up, services: [] };
    const lat = block.match(/<times srtt="(\d+)"/)?.[1];
    if (lat) host.latencyMs = Math.round(Number(lat) / 1000);
    const osm = block.match(/<osmatch name="([^"]+)" accuracy="(\d+)"/);
    if (osm) {
      host.os = `${osm[1]} (${osm[2]}%)`;
      osSeen = true;
    }
    for (const p of block.match(/<port\b[\s\S]*?<\/port>/g) ?? []) {
      if (!/<state state="open"/.test(p)) continue;
      const svc: ScanService = {
        port: Number(attr(p, 'portid') ?? 0),
        proto: attr(p, 'protocol') ?? 'tcp',
        state: 'open',
        service: p.match(/<service name="([^"]+)"/)?.[1],
        product: p.match(/product="([^"]+)"/)?.[1],
        version: p.match(/\sversion="([^"]+)"/)?.[1],
      };
      svc.risk = classify(svc);
      host.services.push(svc);
    }
    // NSE script findings (deep profile): host + port level
    const scripts: string[] = [];
    for (const sc of block.match(/<script id="([^"]+)" output="([^"]*)"/g) ?? []) {
      const m = sc.match(/id="([^"]+)" output="([^"]*)"/);
      if (m && /VULNERABLE|CVE-|risk|exploit/i.test(m[2]!)) scripts.push(`${m[1]}: ${m[2]!.replace(/&#x?[0-9a-f]+;/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, 160)}`);
    }
    if (scripts.length) host.scripts = scripts.slice(0, 8);
    hosts.push(host);
  }
  return { hosts, osSeen };
}

export function scorePosture(hosts: ScanHost[]): PostureReport {
  const findings: PostureFinding[] = [];
  let score = 100;
  let openPorts = 0;
  let risky = 0;
  const sevPenalty: Record<SecSeverity, number> = { critical: 22, high: 12, medium: 6, low: 2, info: 0 };
  for (const h of hosts) {
    for (const sc of h.scripts ?? []) {
      score -= 10;
      risky++;
      findings.push({ severity: 'high', host: h.host, title: `Vulnerability finding on ${h.host}`, detail: sc, recommendation: 'Review the CVE/script output and patch or mitigate the affected service.' });
    }
    // end-of-life OS (deprecated → unpatched), from the open-source EOL intel
    const osHit = vulnForOs(h.os);
    if (osHit) {
      score -= sevPenalty[osHit.severity];
      risky++;
      findings.push({ severity: osHit.severity, host: h.host, title: `End-of-life OS: ${osHit.product}`, detail: `${osHit.product} is past end-of-life${osHit.eolSince ? ` (unsupported since ${osHit.eolSince})` : ''} — it no longer receives security patches, so known vulnerabilities stay open.`, recommendation: osHit.latest ? `Upgrade to a supported release (latest: ${osHit.latest}).` : 'Upgrade to a vendor-supported, patched release.' });
    }
    for (const svc of h.services) {
      openPorts++;
      // end-of-life / deprecated service version (independent of port-risk)
      const vHit = vulnForService(svc.product, svc.service, svc.version);
      if (vHit) {
        score -= sevPenalty[vHit.severity];
        risky++;
        findings.push({ severity: vHit.severity, host: h.host, title: `Deprecated service: ${vHit.product} ${vHit.version} on ${h.host}:${svc.port}`, detail: `${vHit.product} ${vHit.version} is end-of-life${vHit.eolSince ? ` (unsupported since ${vHit.eolSince})` : ''} — an unpatched, deprecated version with known vulnerabilities.`, recommendation: vHit.latest ? `Update to a supported version (latest: ${vHit.latest}).` : 'Update to a supported, patched version.' });
      }
      if (!svc.risk) continue;
      risky++;
      const rule = RISKS.find((r) => r.re.test(`${svc.port} ${svc.service ?? ''} ${svc.product ?? ''}`));
      score -= sevPenalty[svc.risk];
      findings.push({ severity: svc.risk, host: h.host, title: `${svc.service || 'service'} exposed on ${h.host}:${svc.port}`, detail: `${svc.proto}/${svc.port}${svc.version ? ` (${svc.version})` : ''} — ${rule?.why ?? 'risky exposed service.'}`, recommendation: rule?.rec ?? 'Restrict or disable this service.' });
    }
  }
  if (openPorts > 25) {
    score -= 8;
    findings.push({ severity: 'medium', title: 'Large attack surface', detail: `${openPorts} open ports across ${hosts.length} hosts.`, recommendation: 'Close unused services; segment with the firewall.' });
  }
  score = Math.max(0, Math.min(100, Math.round(score)));
  const grade = score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 55 ? 'D' : 'F';
  const order: Record<SecSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);
  return { score, grade, generatedAt: new Date().toISOString(), findings, summary: { hosts: hosts.filter((h) => h.up).length, openPorts, risky } };
}

export const SCAN_PROFILES: ScanProfileInfo[] = [
  { id: 'discovery', name: 'Discovery', description: 'Find live hosts only — ping sweep, no port scan.', depth: 'host up/down', eta: 'seconds' },
  { id: 'quick', name: 'Quick', description: 'Top 100 ports, no version/OS. Fast triage.', depth: 'ports', eta: '~30s / host' },
  { id: 'standard', name: 'Standard', description: 'Top 200 ports + service/version + OS fingerprint.', depth: 'ports · versions · OS', eta: '~1–2 min / host' },
  { id: 'deep', name: 'Deep', description: 'All 65,535 ports, aggressive detection + NSE vuln scripts (CVE checks).', depth: 'full · vuln scripts', eta: 'many minutes / host' },
  { id: 'custom', name: 'Custom', description: 'Pick the ports and toggles yourself.', depth: 'your choice', eta: 'varies' },
];

// --privileged: nmap 7.x mis-detects capability-granted privilege and self-aborts
// even when CAP_NET_RAW is effective; forcing it skips the faulty check.
const PORTS_RE = /^[0-9]+(-[0-9]+)?(,[0-9]+(-[0-9]+)?)*$/;
function profileArgs(req: ScanRequest, t: string): { args: string[]; osWanted: boolean } {
  const v = req.verbose ? '-vv' : '-v';
  const base = ['--privileged', '-T4', '--stats-every', '2s', v, '-oX', '-'];
  const ping = ['-PE', '-PP', '-PM'];
  switch (req.profile ?? 'standard') {
    case 'discovery':
      return { args: ['--privileged', '-sn', ...ping, '-v', '-oX', '-', t], osWanted: false };
    case 'quick':
      return { args: [...base, '-sS', '-F', ...ping, t], osWanted: false };
    case 'deep':
      return { args: [...base, '-sS', '-A', '-p-', '--script', 'default,vuln', ...ping, t], osWanted: true };
    case 'custom': {
      const a = [...base, '-sS', ...ping];
      if (req.version !== false) a.push('-sV');
      if (req.os) a.push('-O', '--osscan-guess');
      if (req.scripts) a.push('--script', 'vuln');
      // operator-supplied extra flags — argv only (no shell). Reject output/input
      // flags, anything with a path or `..`, and the file/NSE-loading flags that
      // could read or write arbitrary files (nmap runs with raw-socket caps).
      if (req.extraArgs) {
        const blocked = /^-o[XNGAS]$|^-iL$|^--script(-args|-help|-trace)?$|^--script-path$|^--datadir$|^--resume$|^--stylesheet$|[;&|`$<>]|\/|\.\./;
        for (const x of req.extraArgs.split(/\s+/)) if (x && !blocked.test(x)) a.push(x);
      }
      const ports = (req.ports ?? '').trim();
      a.push('-p', ports && PORTS_RE.test(ports) ? ports : '1-1024');
      a.push(t);
      return { args: a, osWanted: req.os || /(-O|-A)\b/.test(req.extraArgs ?? '') };
    }
    default: // standard
      return { args: [...base, '-sS', '-sV', '-O', '--osscan-guess', '--top-ports', '200', ...ping, t], osWanted: true };
  }
}
const UNPRIV_ARGS = (t: string): string[] => ['-sT', '-sV', '-Pn', '-T4', '--top-ports', '200', '--stats-every', '2s', '-v', '-oX', '-', t];

function log(line: string): void {
  if (!lastScan) return;
  lastScan.log = [...(lastScan.log ?? []), line].slice(-220);
}

function spawnNmap(args: string[], onDone: (xml: string, code: number | null, privErr: boolean) => void): void {
  const p = spawn('nmap', args, { timeout: 600_000 });
  currentProc = p;
  let xml = '';
  let privErr = false;
  let bindDenied = 0; // -sV source-port binds that need CAP_NET_BIND_SERVICE
  p.stdout.on('data', (d: Buffer) => (xml += d.toString()));
  p.stderr.on('data', (d: Buffer) => {
    for (const ln of d.toString().split('\n')) {
      const s = ln.trim();
      if (!s) continue;
      if (/requires? (root|privilege)|QUITTING|raw sockets?|operation not permitted/i.test(s)) privErr = true;
      // verbose mode: show the FULL nmap output, unfiltered
      if (verboseMode) {
        log(s);
        continue;
      }
      // normal mode: -sV binds privileged source ports without the cap → noisy NSOCK errors.
      // count them, log one sample, emit one actionable hint at the end — don't spam.
      if (/mksock_bind_addr|NSOCK ERROR.*Permission denied|Permission denied \(13\)/i.test(s)) {
        if (bindDenied === 0) log('… -sV is probing from privileged source ports without permission — suppressing repeated NSOCK noise (run with Verbose to see all).');
        bindDenied += 1;
        continue;
      }
      if (/adjust_timeouts2|packet supposedly had rtt/i.test(s)) continue; // benign timing noise
      log(s);
    }
  });
  p.on('error', (e) => {
    log(`error: ${e.message}`);
    onDone(xml, 1, /ENOENT/.test(e.message) ? false : privErr);
  });
  p.on('close', (code) => {
    if (bindDenied > 0) {
      log(`⚠ ${bindDenied} version-detection probe(s) couldn't bind privileged source ports — scan results are still valid but -sV is degraded. For clean version detection grant nmap the capability once: sudo bash deploy/setup-scan-caps.sh`);
    }
    onDone(xml, code, privErr);
  });
}

export function scanProfiles(): ScanProfileInfo[] {
  return SCAN_PROFILES;
}

/** Validate + kick off a scan in the background; returns the running stub. Poll currentScan(). */
export function startScan(req: ScanRequest): ScanResult {
  const t = (req.target || '').trim();
  if (!TARGET_RE.test(t)) throw new Error('invalid target — use a hostname, IP, or IP/CIDR (no spaces or special characters)');
  if (running) throw new Error('a scan is already running');
  running = true;
  cancelled = false;
  verboseMode = req.verbose === true;
  const started = Date.now();
  const { args } = profileArgs(req, t);
  lastScan = { id: randomUUID(), target: t, profile: req.profile ?? 'standard', startedAt: new Date(started).toISOString(), running: true, hosts: [], log: [`▶ nmap ${args.join(' ')}`] };
  pushLog('security', 'info', `scan started: ${t} (${req.profile ?? 'standard'})`);

  // heartbeat: prove the scan is alive by logging elapsed time every 30s
  stopHeartbeat();
  heartbeat = setInterval(() => {
    if (!running) {
      stopHeartbeat();
      return;
    }
    const secs = Math.round((Date.now() - started) / 1000);
    log(`⏱ ${Math.floor(secs / 60)}m ${String(secs % 60).padStart(2, '0')}s elapsed — scanning ${t}…`);
  }, 30_000);

  const finish = (xml: string): void => {
    running = false;
    stopHeartbeat();
    const { hosts, osSeen } = parseXml(xml);
    const finished = Date.now();
    lastScan = { ...lastScan!, running: false, finishedAt: new Date(finished).toISOString(), durationMs: finished - started, hosts, osDetection: osSeen, error: !hosts.length && !xml ? 'nmap produced no output (is nmap installed?)' : undefined };
    const up = hosts.filter((h) => h.up).length;
    const ports = hosts.reduce((a, h) => a + h.services.length, 0);
    log(`✔ done — ${up} host(s) up, ${ports} open ports${osSeen ? ', OS detected' : ''} in ${Math.round((finished - started) / 1000)}s`);
    pushLog('security', 'info', `scan complete: ${t} — ${up} up, ${ports} open ports${osSeen ? ', OS detected' : ''}`);
  };

  spawnNmap(args, (xml, _code, privErr) => {
    if (cancelled) return; // killed by the operator — don't fall back or overwrite
    if (privErr && !xml.includes('<host')) {
      log('⚠ no raw-socket capability — falling back to a connect scan (OS detection unavailable).');
      spawnNmap(UNPRIV_ARGS(t), (xml2) => {
        if (!cancelled) finish(xml2);
      });
    } else {
      finish(xml);
    }
  });
  return lastScan;
}

// ── schedule ──
let schedule: ScanSchedule = { enabled: false, intervalSec: 0, target: '' };
try {
  schedule = { ...schedule, ...(JSON.parse(fs.readFileSync(SCHED_FILE, 'utf8')) as ScanSchedule) };
} catch {
  /* defaults */
}
function persistSchedule(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SCHED_FILE, JSON.stringify(schedule, null, 2));
}

export function getSchedule(): ScanSchedule {
  return { ...schedule };
}
export function setSchedule(s: Partial<ScanSchedule>): ScanSchedule {
  schedule = { ...schedule, ...s };
  schedule.enabled = schedule.enabled && schedule.intervalSec > 0 && !!schedule.target;
  schedule.nextRun = schedule.enabled ? new Date(Date.now() + schedule.intervalSec * 1000).toISOString() : undefined;
  persistSchedule();
  return getSchedule();
}

/** Background scheduler — fires a scan when the interval elapses. */
export function startScanScheduler(): void {
  setInterval(() => {
    if (!schedule.enabled || schedule.intervalSec <= 0 || !schedule.target || running) return;
    const due = !schedule.nextRun || Date.now() >= new Date(schedule.nextRun).getTime();
    if (!due) return;
    try {
      startScan({ target: schedule.target, profile: 'standard' });
      schedule.lastRun = new Date().toISOString();
      schedule.nextRun = new Date(Date.now() + schedule.intervalSec * 1000).toISOString();
      persistSchedule();
    } catch {
      /* a scan is already running — try next tick */
    }
  }, 30_000);
}
