'use client';

import { useState } from 'react';
import { Radar, Server, Plug, ChevronRight, ChevronDown, Monitor, Laptop, Smartphone, Terminal, Router, HelpCircle, ScanSearch, Clock, X, AlertTriangle, RefreshCw, ShieldAlert } from 'lucide-react';
import type { ClientOs, DeviceDiscovery, PostureReport, ScanProfileId, ScanProfileInfo, ScanResult, ScanSchedule, ScannerConnection, ScannerStats, SecurityDevice, SecuritySettings, VulnIntelState } from '@nexrelm/types';
import { useSec, secSend, secGet, SEV_COLOR } from '@/lib/security';
import { cn, relTime, num } from '@/lib/format';
import { Panel, PanelHeader } from '@/components/ui/Panel';
import { Gauge } from '@/components/ui/Gauge';
import { Badge } from '@/components/ui/Badge';
import { StatusDot } from '@/components/ui/StatusDot';
import { UsageBar } from '@/components/ui/UsageBar';

const OS_ICON: Record<ClientOs, typeof Monitor> = { windows: Monitor, macos: Laptop, linux: Terminal, ios: Smartphone, android: Smartphone, network: Router, other: HelpCircle };
const INTERVALS = [
  { label: 'Off (manual)', sec: 0 },
  { label: 'Every 15 min', sec: 900 },
  { label: 'Every hour', sec: 3600 },
  { label: 'Every 6 hours', sec: 21600 },
  { label: 'Every 24 hours', sec: 86400 },
];

export function Vulnerabilities() {
  const { data: scan, refresh: refreshScan } = useSec<ScanResult | null>('/api/security/scan', 2000);
  const { data: posture } = useSec<PostureReport | null>('/api/security/posture', 3000);
  const { data: devices, refresh: refreshDevices } = useSec<SecurityDevice[]>('/api/security/devices', 8000);
  const { data: discovery } = useSec<DeviceDiscovery>('/api/security/devices/discovery', 3000);
  const { data: settings, refresh: refreshSettings } = useSec<SecuritySettings>('/api/security/settings', 0);
  const running = scan?.running;

  async function scanTarget(target: string, extra?: Record<string, unknown>) {
    try {
      await secSend('POST', '/api/security/scan', { target, ...extra });
      refreshScan();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'scan failed');
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <VulnIntel />
      {/* posture + scan control */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[290px_1fr]">
        <Panel brackets>
          <PanelHeader label="Posture" title="Network stance" hint={posture ? `grade ${posture.grade} · ${posture.summary.risky} risky` : 'run a scan'} />
          <div className="flex flex-col items-center gap-3 px-5 pb-5 pt-2">
            <Gauge ratio={(posture?.score ?? 0) / 100} color={(posture?.score ?? 0) >= 80 ? 'var(--good)' : (posture?.score ?? 0) >= 60 ? 'var(--warn)' : 'var(--danger)'} label="score" />
            {posture ? (
              <div className="grid w-full grid-cols-3 gap-2 text-center text-xs">
                <Mini label="hosts" v={posture.summary.hosts} />
                <Mini label="open ports" v={posture.summary.openPorts} />
                <Mini label="risky" v={posture.summary.risky} c="var(--danger)" />
              </div>
            ) : (
              <p className="text-center text-xs text-faint">Scan a host or the whole subnet to compute your posture and recommendations.</p>
            )}
          </div>
        </Panel>
        <ScanControl scan={scan ?? null} onScan={scanTarget} onRefresh={refreshScan} />
      </div>

      {/* network devices */}
      <DeviceInventory devices={devices ?? []} discovery={discovery ?? undefined} onScan={scanTarget} onRefresh={refreshDevices} scanningTarget={running ? scan?.target : undefined} />

      {posture && posture.findings.length > 0 && (
        <div className="rounded-xl border border-line bg-[var(--bg-2)]/30 px-5 py-3 text-sm text-muted">
          {posture.findings.length} finding{posture.findings.length === 1 ? '' : 's'} from the last scan — open the <span className="text-accent">Remediation</span> tab to review and act on them per device.
        </div>
      )}

      {/* external scanner stats */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <ScannerPanel kind="nessus" conn={settings?.nessus} onSaved={refreshSettings} hint="Tenable Nessus — authenticated deep vuln scans" placeholder="https://nessus.lan:8834" tokenHint="accessKey:secretKey" />
        <ScannerPanel kind="wazuh" conn={settings?.wazuh} onSaved={refreshSettings} hint="Wazuh — host IDS / agents & CVE detection" placeholder="https://wazuh.lan:55000" tokenHint="user:password" />
      </div>
    </div>
  );
}

// ── scan control: profile, target, schedule, verbose log ──
function ScanControl({ scan, onScan, onRefresh }: { scan: ScanResult | null; onScan: (t: string, extra?: Record<string, unknown>) => void; onRefresh: () => void }) {
  const { data: schedule, refresh } = useSec<ScanSchedule>('/api/security/scan/schedule', 0);
  const { data: profiles } = useSec<ScanProfileInfo[]>('/api/security/scan/profiles', 0);
  const [target, setTarget] = useState('192.168.1.0/24');
  const [profile, setProfile] = useState<ScanProfileId>('standard');
  const [custom, setCustom] = useState({ ports: '1-1024', version: true, os: true, scripts: false, extraArgs: '' });
  const [showLog, setShowLog] = useState(true);
  const [verbose, setVerbose] = useState(false);
  const running = scan?.running;
  const active = (profiles ?? []).find((p) => p.id === profile);
  const req = () => (profile === 'custom' ? { profile, ...custom, verbose } : { profile, verbose });

  async function setIntervalSec(sec: number) {
    await secSend('POST', '/api/security/scan/schedule', { enabled: sec > 0, intervalSec: sec, target });
    refresh();
  }

  return (
    <Panel>
      <PanelHeader label="Scanner" title="nmap exposure scan" hint="choose a depth — like a scan policy" right={<Radar size={16} className={running ? 'animate-spin text-accent' : 'text-accent'} />} />
      <div className="flex flex-col gap-2 px-5 pb-3 pt-3">
        {/* scan profile selector */}
        <div className="flex flex-wrap gap-1.5">
          {(profiles ?? []).map((p) => (
            <button key={p.id} onClick={() => setProfile(p.id)} title={p.description} className={cn('rounded-lg border px-2.5 py-1 text-xs transition-colors', profile === p.id ? 'border-accent/50 bg-[color-mix(in_oklch,var(--accent)_12%,transparent)] text-accent' : 'border-line text-muted hover:text-text')}>{p.name}</button>
          ))}
        </div>
        {active && <p className="text-[0.66rem] text-faint">{active.description} <span className="text-muted">· depth: {active.depth} · {active.eta}</span></p>}
        {profile === 'custom' && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-[var(--bg-2)]/40 px-3 py-2 text-xs">
            <input value={custom.ports} onChange={(e) => setCustom({ ...custom, ports: e.target.value })} placeholder="ports e.g. 1-1024 or 22,80,443" className="w-48 rounded border border-line bg-[var(--bg-2)] px-2 py-1 font-mono text-text outline-none" />
            <label className="flex items-center gap-1 text-muted"><input type="checkbox" checked={custom.version} onChange={(e) => setCustom({ ...custom, version: e.target.checked })} className="accent-[var(--accent)]" /> version</label>
            <label className="flex items-center gap-1 text-muted"><input type="checkbox" checked={custom.os} onChange={(e) => setCustom({ ...custom, os: e.target.checked })} className="accent-[var(--accent)]" /> OS</label>
            <label className="flex items-center gap-1 text-muted"><input type="checkbox" checked={custom.scripts} onChange={(e) => setCustom({ ...custom, scripts: e.target.checked })} className="accent-[var(--accent)]" /> vuln scripts</label>
            <input value={custom.extraArgs} onChange={(e) => setCustom({ ...custom, extraArgs: e.target.value })} placeholder="extra nmap flags e.g. -T2 --script ssl-enum-ciphers" className="w-full rounded border border-line bg-[var(--bg-2)] px-2 py-1 font-mono text-text outline-none" />
            <span className="text-[0.62rem] text-faint">The checklist sets the base; these flags are appended (output flags are ignored). Final command runs as <span className="font-mono">nmap --privileged -sS … {custom.extraArgs}</span></span>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <input value={target} onChange={(e) => setTarget(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !running && onScan(target, req())} placeholder="192.168.1.0/24 · 10.0.0.5 · host.lan" className="min-w-[200px] flex-1 rounded-lg border border-line bg-[var(--bg-2)] px-3 py-2 font-mono text-sm text-text outline-none placeholder:text-faint focus:border-accent/50" />
          {running ? (
            <button onClick={() => secSend('POST', '/api/security/scan/cancel').then(onRefresh)} className="flex items-center gap-1.5 rounded-lg border border-danger/40 bg-[color-mix(in_oklch,var(--danger)_12%,transparent)] px-4 py-2 text-sm font-medium text-danger"><X size={14} /> Cancel</button>
          ) : (
            <button onClick={() => onScan(target, req())} className="flex items-center gap-1.5 rounded-lg border border-accent/40 bg-[color-mix(in_oklch,var(--accent)_14%,transparent)] px-4 py-2 text-sm font-medium text-accent"><Radar size={14} /> Scan</button>
          )}
          <label className="flex items-center gap-1.5 text-xs text-muted" title="Show full nmap output (-vv), unfiltered">
            <input type="checkbox" checked={verbose} onChange={(e) => setVerbose(e.target.checked)} className="accent-[var(--accent)]" /> Verbose
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <Clock size={13} className="text-faint" /> Auto-scan:
          <select value={schedule?.enabled ? schedule.intervalSec : 0} onChange={(e) => setIntervalSec(Number(e.target.value))} className="rounded-lg border border-line bg-[var(--bg-2)] px-2 py-1 text-text outline-none">
            {INTERVALS.map((i) => <option key={i.sec} value={i.sec}>{i.label}</option>)}
          </select>
          {schedule?.enabled && schedule.nextRun && <span className="text-faint">next {relTime(schedule.nextRun)}</span>}
          <button onClick={() => setShowLog((v) => !v)} className="ml-auto text-faint hover:text-text">{showLog ? 'hide' : 'show'} output</button>
        </div>
        {scan && <p className="text-xs text-faint">{running ? `scanning ${scan.target}…` : scan.error ? <span className="text-danger">error: {scan.error}</span> : scan.finishedAt ? `${scan.target} · ${scan.hosts.filter((h) => h.up).length} up · ${scan.hosts.reduce((a, h) => a + h.services.length, 0)} ports · ${scan.osDetection ? 'OS detected' : 'no OS (-O needs raw socket)'} · ${scan.durationMs ? Math.round(scan.durationMs / 1000) : '?'}s` : ''}</p>}
      </div>
      {showLog && (scan?.log?.length ?? 0) > 0 && (
        <pre className="mx-5 mb-4 max-h-44 overflow-auto rounded-lg border border-line bg-[var(--bg-1)] p-2.5 font-mono text-[0.66rem] leading-relaxed text-muted no-scrollbar">{(scan?.log ?? []).join('\n')}</pre>
      )}
    </Panel>
  );
}

// ── device inventory ──
function DeviceInventory({ devices, discovery, onScan, onRefresh, scanningTarget }: { devices: SecurityDevice[]; discovery?: DeviceDiscovery; onScan: (t: string) => void; onRefresh: () => void; scanningTarget?: string }) {
  const [busy, setBusy] = useState(false);
  const online = devices.filter((d) => d.online).length;
  async function discover() {
    setBusy(true);
    try {
      await secSend('POST', '/api/security/devices/discover', {});
      onRefresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel>
      <PanelHeader
        label="Network"
        title="Devices on the network"
        hint={`${devices.length} known · ${online} online`}
        right={<button onClick={discover} disabled={busy || discovery?.running} className="flex items-center gap-1.5 rounded-lg border border-accent/40 bg-[color-mix(in_oklch,var(--accent)_14%,transparent)] px-3 py-1.5 text-xs font-medium text-accent disabled:opacity-50"><ScanSearch size={13} className={discovery?.running ? 'animate-pulse' : ''} /> {discovery?.running ? 'Discovering…' : 'Discover network'}</button>}
      />
      <div className="max-h-[440px] overflow-y-auto border-t border-line">
        {devices.length === 0 && <div className="px-5 py-8 text-center text-sm text-faint">No devices yet — click “Discover network” (ARP + ping sweep), or devices appear as they use the DNS resolver.</div>}
        {devices.map((d) => <DeviceRow key={d.ip} d={d} onScan={onScan} scanning={scanningTarget === d.ip} />)}
      </div>
    </Panel>
  );
}

function DeviceRow({ d, onScan, scanning }: { d: SecurityDevice; onScan: (t: string) => void; scanning: boolean }) {
  const [open, setOpen] = useState(false);
  const Icon = OS_ICON[d.os];
  return (
    <div className="border-b border-line/50 last:border-0">
      <div className="flex flex-wrap items-center gap-3 px-5 py-2.5">
        <button onClick={() => setOpen((v) => !v)} className="text-faint hover:text-accent">{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>
        <StatusDot color={d.online ? 'var(--good)' : 'var(--faint)'} pulse={false} />
        <Icon size={15} className="text-muted" />
        <span className="min-w-0">
          <span className="block truncate text-sm text-text">{d.hostname ? d.hostname : <>{d.ip} <span className="text-[0.72rem] text-faint">({d.os})</span></>}</span>
          <span className="block truncate font-mono text-[0.62rem] text-faint">{d.hostname ? d.ip : ''}{d.mac ? `${d.hostname ? ' · ' : ''}${d.mac}` : ''}</span>
        </span>
        {d.vendor && <span className="hidden text-xs text-faint md:inline">{d.vendor}</span>}
        {d.risk && <Badge color={SEV_COLOR[d.risk]}>{d.risk}</Badge>}
        {d.openPorts.length > 0 && <span className="text-xs text-muted">{d.openPorts.length} open</span>}
        <span className="ml-auto flex items-center gap-2">
          {d.queries > 0 && <span className="text-[0.62rem] text-faint">{num(d.queries)} dns</span>}
          <button onClick={() => onScan(d.ip)} disabled={scanning} className="flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-xs text-muted hover:text-accent disabled:opacity-50"><Radar size={12} className={scanning ? 'animate-spin' : ''} /> Scan</button>
        </span>
      </div>
      {open && (
        <div className="px-5 pb-3 pl-12 text-xs">
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-faint">
            <span>OS guess: <span className="text-muted">{d.os}</span></span>
            <span>seen via: <span className="text-muted">{d.sources.join(', ')}</span></span>
            <span>first: <span className="text-muted">{relTime(d.firstSeen)}</span></span>
            <span>last: <span className="text-muted">{relTime(d.lastSeen)}</span></span>
          </div>
          {d.openPorts.length > 0 ? (
            <div className="mt-2 flex flex-col gap-1">
              {d.openPorts.map((s) => (
                <div key={s.port} className="flex flex-wrap items-center gap-2">
                  <span className="stat w-12 text-right text-text">{s.port}</span>
                  <span className="w-10 text-faint">{s.proto}</span>
                  <span className="w-24 text-muted">{s.service ?? '—'}</span>
                  <span className="min-w-0 flex-1 truncate text-faint">{s.version ?? ''}</span>
                  {s.risk && <Badge color={SEV_COLOR[s.risk]}>{s.risk}</Badge>}
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-faint">{d.scanned ? 'no open ports found' : 'not scanned yet — hit Scan to check this device for exposed services.'}</p>
          )}
          {d.scripts && d.scripts.length > 0 && (
            <div className="mt-3">
              <div className="label mb-1 text-danger">Vulnerabilities</div>
              <div className="flex flex-col gap-1">
                {d.scripts.map((s, i) => (
                  <div key={i} className="flex items-start gap-1.5 text-[0.66rem]"><AlertTriangle size={11} className="mt-0.5 shrink-0 text-danger" /><span className="text-muted">{s}</span></div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── external scanner stats ──
function ScannerPanel({ kind, conn, onSaved, hint, placeholder, tokenHint }: { kind: 'nessus' | 'wazuh'; conn?: ScannerConnection; onSaved: () => void; hint: string; placeholder: string; tokenHint: string }) {
  const [url, setUrl] = useState(conn?.url ?? '');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [stats, setStats] = useState<ScannerStats | null>(null);

  async function connect() {
    if (!url.trim()) return;
    setBusy(true);
    try {
      await secSend('POST', '/api/security/scanner', { kind, url: url.trim(), token: token.trim() });
      setToken('');
      onSaved();
    } finally {
      setBusy(false);
    }
  }
  async function loadStats() {
    setStats(await secGet<ScannerStats>(`/api/security/scanner/stats?kind=${kind}`));
  }

  const SEVS = ['critical', 'high', 'medium', 'low', 'info'];
  return (
    <Panel>
      <PanelHeader label="Integration" title={kind === 'nessus' ? 'Nessus' : 'Wazuh'} hint={hint} right={<Server size={15} className={conn?.configured ? 'text-good' : 'text-faint'} />} />
      <div className="flex flex-col gap-2 px-5 pb-3 pt-3">
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={placeholder} className="rounded-lg border border-line bg-[var(--bg-2)] px-3 py-2 font-mono text-xs text-text outline-none placeholder:text-faint focus:border-accent/50" />
        <div className="flex gap-2">
          <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder={`token (${tokenHint})`} className="flex-1 rounded-lg border border-line bg-[var(--bg-2)] px-3 py-2 font-mono text-xs text-text outline-none placeholder:text-faint focus:border-accent/50" />
          <button onClick={connect} disabled={busy} className="flex items-center gap-1.5 rounded-lg border border-accent/40 bg-[color-mix(in_oklch,var(--accent)_14%,transparent)] px-3 py-2 text-sm font-medium text-accent disabled:opacity-50"><Plug size={14} /> {busy ? '…' : 'Connect'}</button>
        </div>
      </div>
      <div className="flex items-center gap-2 px-5 pb-3 text-xs">
        <StatusDot color={conn?.configured ? (conn.reachable ? 'var(--good)' : 'var(--warn)') : 'var(--faint)'} pulse={false} />
        <span className={cn(conn?.configured ? 'text-muted' : 'text-faint')}>{conn?.configured ? (conn.reachable ? 'configured · reachable' : 'configured · unreachable (check URL/TLS)') : 'not configured — token stored encrypted'}</span>
        {conn?.configured && <button onClick={loadStats} className="ml-auto rounded border border-line px-2 py-0.5 text-faint hover:text-text">load stats</button>}
      </div>
      {stats && (
        <div className="border-t border-line px-5 py-3">
          {!stats.ok ? (
            <p className="text-xs text-danger">{stats.error}</p>
          ) : (
            <>
              <div className="mb-2 flex flex-wrap gap-2">
                {stats.totals.map((t) => <span key={t.label} className="rounded border border-line px-2 py-0.5 text-xs text-muted">{t.label}: <span className="text-text">{t.value}</span></span>)}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {SEVS.filter((s) => stats.severityCounts[s]).map((s) => <Badge key={s} color={SEV_COLOR[s]}>{s}: {stats.severityCounts[s]}</Badge>)}
                {Object.keys(stats.severityCounts).length === 0 && <span className="text-xs text-faint">connected — no vulnerability data returned (check scan/agent config)</span>}
              </div>
              {stats.top.length > 0 && <div className="mt-2 flex flex-col gap-0.5">{stats.top.slice(0, 6).map((v, i) => <div key={i} className="flex items-center gap-2 text-xs"><span className="h-1.5 w-1.5 rounded-full" style={{ background: SEV_COLOR[v.severity] }} /><span className="min-w-0 flex-1 truncate text-muted">{v.name}</span>{v.count != null && <span className="text-faint">{v.count}</span>}</div>)}</div>}
            </>
          )}
        </div>
      )}
    </Panel>
  );
}

function Mini({ label, v, c }: { label: string; v: number; c?: string }) {
  return (
    <div>
      <div className="stat text-lg font-semibold" style={{ color: c ?? 'var(--text)' }}>{v}</div>
      <div className="text-[0.6rem] text-faint">{label}</div>
    </div>
  );
}

function VulnIntel() {
  const { data, refresh } = useSec<VulnIntelState>('/api/security/vuln-intel', 0);
  const [busy, setBusy] = useState(false);
  async function doRefresh() {
    setBusy(true);
    try {
      await secSend('POST', '/api/security/vuln-intel/refresh');
      refresh();
    } finally {
      setBusy(false);
    }
  }
  const refreshing = busy || data?.refreshing;
  return (
    <Panel>
      <PanelHeader
        label="Intel"
        title="Vulnerability intelligence"
        hint={data ? `${data.provider} · ${data.loaded}/${data.products} products · ${num(data.total)} release cycles` : 'loading…'}
        right={
          <button onClick={doRefresh} disabled={refreshing} className="flex items-center gap-1.5 rounded-lg border border-accent/40 bg-[color-mix(in_oklch,var(--accent)_14%,transparent)] px-3 py-1.5 text-xs font-medium text-accent disabled:opacity-50">
            <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} /> {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        }
      />
      <div className="flex items-start gap-2 px-5 pb-4 pt-1">
        <ShieldAlert size={14} className="mt-0.5 shrink-0 text-warn" />
        <p className="text-[0.66rem] text-faint">
          Free open-source EOL data from <span className="text-muted">endoflife.date</span> (no API key). Scans flag services and OSs that are <span className="text-warn">end-of-life</span> — deprecated, unpatched, and exposed to known vulnerabilities — as findings on the device and in Remediation.
          {data?.lastRefresh ? <> Last refreshed {relTime(data.lastRefresh)}.</> : <> Not refreshed yet — hit Refresh.</>}
        </p>
      </div>
    </Panel>
  );
}
