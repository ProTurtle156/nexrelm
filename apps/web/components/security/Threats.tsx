'use client';

import { useState } from 'react';
import { Search, ShieldAlert, KeyRound, Check, Bug, Network } from 'lucide-react';
import { Sinkhole } from './Sinkhole';
import { Tuning } from './Tuning';
import type { AutoIntelState, SecuritySettings, SecurityAlert, ThreatFeedState, ThreatLookup } from '@nexrelm/types';
import { useSec, secSend, SEV_COLOR } from '@/lib/security';
import { num } from '@/lib/format';
import { Panel, PanelHeader } from '@/components/ui/Panel';
import { Badge } from '@/components/ui/Badge';
import { relTime } from '@/lib/format';

export function Threats() {
  const { data: alerts, refresh } = useSec<SecurityAlert[]>('/api/security/alerts?window=300', 4000);
  const { data: settings, refresh: refreshSettings } = useSec<SecuritySettings>('/api/security/settings', 0);

  async function ack(id: string) {
    await secSend('POST', `/api/security/alerts/${encodeURIComponent(id)}/ack`);
    refresh();
  }

  const active = (alerts ?? []).filter((a) => !a.acknowledged);

  return (
    <div className="flex flex-col gap-5">
      <DetectionCoverage />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_360px]">
        {/* detections */}
        <Panel>
          <PanelHeader label="Detections" title="Heuristic threat engine" hint={`${active.length} active · DNS + wire + L2 + intel`} right={<Bug size={16} className="text-accent" />} />
          <div className="flex flex-col">
            {(alerts ?? []).length === 0 && <div className="px-5 py-10 text-center text-sm text-faint">No threats detected in the current window. The engine watches the DNS stream <span className="text-muted">and</span> all captured traffic — wire flows, ARP/L2, DHCP, and LLMNR/NBT-NS — for floods, scans, spoofing, poisoning, lateral movement, exfiltration, and known-bad contact.</div>}
            {(alerts ?? []).map((a) => (
              <div key={a.id} className={`flex items-start gap-3 border-b border-line/50 px-5 py-3 last:border-0 ${a.acknowledged ? 'opacity-50' : ''}`}>
                <span className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: SEV_COLOR[a.severity], boxShadow: `0 0 7px ${SEV_COLOR[a.severity]}` }} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-text">{a.title}</span>
                    <Badge color={SEV_COLOR[a.severity]}>{a.severity}</Badge>
                    <Badge color="var(--accent-dim)">{a.kind.replace(/_/g, ' ')}</Badge>
                    {a.mitre && <span className="rounded border border-violet/40 px-1.5 py-0.5 text-[0.6rem] text-violet" title={`MITRE ATT&CK: ${a.mitre.name}`}>{a.mitre.id}</span>}
                    {a.response && <Badge color="var(--accent)">{a.response}</Badge>}
                    <span className="font-mono text-[0.66rem] text-faint">{a.source}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted">{a.detail}</p>
                  {a.evidence && <p className="mt-0.5 truncate font-mono text-[0.62rem] text-faint">e.g. {a.evidence}</p>}
                </div>
                {!a.acknowledged && <button onClick={() => ack(a.id)} className="shrink-0 rounded-lg border border-line px-2.5 py-1 text-xs text-muted hover:text-text">Ack</button>}
              </div>
            ))}
          </div>
        </Panel>

        {/* intel */}
        <div className="flex flex-col gap-5">
          <Tuning />
          <Sinkhole />
          <ThreatFeeds />
          <AutoIntel />
          <VirusTotal configured={settings?.virusTotalConfigured ?? false} />
          <VtKey configured={settings?.virusTotalConfigured ?? false} onSaved={refreshSettings} />
        </div>
      </div>
    </div>
  );
}

// Genuine detectors — each fires on a real attack signature (visibility/data permitting).
const DETECTIONS: Array<{ group: string; color: string; items: string[] }> = [
  { group: 'DNS stream', color: 'var(--accent)', items: ['Query flood', 'NXDOMAIN flood', 'Recon / fanout', 'DGA domains', 'DNS tunneling / exfil', 'C2 beaconing (timing)', 'Aggregate DDoS'] },
  { group: 'Wire & flows', color: 'var(--violet)', items: ['Port scan (horiz/vert)', 'Outbound host sweep', 'Lateral movement', 'C2 / backdoor ports', 'Crypto-mining ports', 'Data egress (by bytes)', 'Known-bad IP on the wire'] },
  { group: 'L2 / MITM', color: 'var(--danger)', items: ['ARP spoofing (MAC-flip)', 'MAC impersonation', 'Rogue DHCP', 'LLMNR / NBT-NS poisoning', 'Responder → AD relay'] },
  { group: 'Correlation', color: 'var(--good)', items: ['VirusTotal auto-intel', 'Threat-intel feeds (IOCs)'] },
];
// Enrichment / context — these label or contextualise, they don't detect an attack on their own.
const ENRICHMENT = ['MITRE ATT&CK tagging on every alert', 'Domain reputation — suspicious TLD / punycode', 'Policy drift — firewall-blocked source still active'];

function DetectionCoverage() {
  return (
    <Panel brackets>
      <PanelHeader label="Coverage" title="What the engine watches" hint="real detections vs. context — honestly separated" right={<Network size={16} className="text-accent" />} />
      <div className="grid grid-cols-2 gap-x-6 gap-y-5 px-5 pt-3 md:grid-cols-4">
        {DETECTIONS.map((g) => (
          <div key={g.group}>
            <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-text">
              <span className="h-2 w-2 rounded-full" style={{ background: g.color, boxShadow: `0 0 6px ${g.color}` }} />
              {g.group}
            </div>
            <ul className="flex flex-col gap-1">
              {g.items.map((it) => (
                <li key={it} className="flex items-start gap-1.5 text-[0.7rem] text-muted">
                  <span className="mt-1 h-1 w-1 shrink-0 rounded-full" style={{ background: g.color, opacity: 0.6 }} />
                  {it}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="mx-5 mt-4 border-t border-line/60 pt-3">
        <div className="mb-1.5 text-xs font-semibold text-faint">Enrichment & context · not detection</div>
        <div className="flex flex-wrap gap-1.5">
          {ENRICHMENT.map((e) => (
            <span key={e} className="rounded-full border border-line px-2 py-0.5 text-[0.66rem] text-muted">{e}</span>
          ))}
        </div>
      </div>
      <p className="mx-5 mb-5 mt-3 rounded-lg border border-warn/30 bg-[color-mix(in_oklch,var(--warn)_7%,transparent)] px-3 py-2 text-[0.66rem] text-muted">
        <span className="font-medium text-warn">Visibility requirements:</span> wire &amp; L2 detection only sees traffic the <span className="text-text">sniffer</span> captures — on a switched LAN that means broadcast + this host, so for full network-wide coverage use a switch <span className="text-text">mirror/SPAN port</span> or the <span className="text-text">inline gateway</span>. DNS detection requires clients to <span className="text-text">resolve through Nexrelm</span> (point DHCP DNS at it). VirusTotal needs an API key.
      </p>
    </Panel>
  );
}

const VERDICT_COLOR: Record<string, string> = { malicious: 'var(--danger)', suspicious: 'var(--warn)', clean: 'var(--good)', unknown: 'var(--faint)' };

function ThreatFeeds() {
  const { data, refresh } = useSec<ThreatFeedState>('/api/security/feeds', 0);
  const [busy, setBusy] = useState(false);
  async function refreshNow() {
    setBusy(true);
    try {
      await secSend('POST', '/api/security/feeds/refresh');
      refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel brackets>
      <PanelHeader label="Threat intel" title="Feeds" hint={data ? `${num(data.totalIndicators)} known-bad indicators` : 'loading…'} right={<button onClick={refreshNow} disabled={busy} className="rounded-lg border border-line px-2.5 py-1.5 text-xs text-muted hover:text-text disabled:opacity-50">{busy ? '…' : 'Refresh'}</button>} />
      <div className="flex flex-col gap-2 px-5 pb-5 pt-2">
        <p className="text-[0.66rem] text-faint">Public block/IOC lists (abuse.ch). The engine cross-references the DNS stream + captured flows against these — no API key needed.</p>
        {(data?.feeds ?? []).map((f) => (
          <div key={f.id} className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={f.enabled} onChange={(e) => secSend('POST', `/api/security/feeds/${f.id}`, { enabled: e.target.checked }).then(refresh)} className="accent-[var(--accent)]" />
            <span className="min-w-0 flex-1 truncate text-text" title={f.url}>{f.name}</span>
            {f.error ? <span className="text-danger">err</span> : <span className="text-muted">{num(f.entries)}</span>}
          </div>
        ))}
      </div>
    </Panel>
  );
}

function AutoIntel() {
  const { data } = useSec<AutoIntelState>('/api/security/intel', 5000);
  return (
    <Panel>
      <PanelHeader label="Auto-intel" title="VirusTotal correlation" hint={data?.configured ? `${data.checkedCount} checked · ${data.queued} queued` : 'add a VT key to enable'} />
      <div className="px-5 pb-4 pt-2">
        <p className="mb-2 text-[0.66rem] text-faint">Suspicious domains/IPs from the heuristic engine are auto-checked against VirusTotal (rate-limited). Malicious hits raise a <span className="text-danger">malware contact</span> alert.</p>
        <div className="flex max-h-60 flex-col gap-1 overflow-y-auto no-scrollbar">
          {(data?.recent ?? []).length === 0 && <p className="py-3 text-center text-xs text-faint">{data?.enabled ? 'nothing flagged yet' : 'monitoring paused'}</p>}
          {(data?.recent ?? []).map((e, i) => (
            <div key={i} className="flex items-center gap-2 border-b border-line/40 py-1.5 text-xs last:border-0">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: VERDICT_COLOR[e.verdict] }} />
              <span className="min-w-0 flex-1 truncate font-mono text-text">{e.indicator}</span>
              {e.malicious > 0 && <span className="shrink-0 text-danger">{e.malicious}✗</span>}
              <span className="shrink-0 text-[0.6rem]" style={{ color: VERDICT_COLOR[e.verdict] }}>{e.verdict}</span>
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}

function VirusTotal({ configured }: { configured: boolean }) {
  const [ind, setInd] = useState('');
  const [res, setRes] = useState<ThreatLookup | null>(null);
  const [busy, setBusy] = useState(false);

  async function check() {
    if (!ind.trim()) return;
    setBusy(true);
    try {
      setRes(await secSend<ThreatLookup>('POST', '/api/security/threat/lookup', { indicator: ind.trim() }));
    } catch (e) {
      setRes({ indicator: ind, kind: 'domain', malicious: 0, suspicious: 0, harmless: 0, undetected: 0, verdict: 'unknown', checkedAt: new Date().toISOString(), error: e instanceof Error ? e.message : 'lookup failed' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel brackets>
      <PanelHeader label="Threat intel" title="VirusTotal lookup" hint="domain · IP · hash · URL" right={<ShieldAlert size={16} className="text-accent" />} />
      <div className="flex flex-col gap-3 px-5 pb-5 pt-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
            <input value={ind} onChange={(e) => setInd(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && check()} placeholder="evil.com · 1.2.3.4 · sha256…" className="w-full rounded-lg border border-line bg-[var(--bg-2)] py-2 pl-9 pr-3 font-mono text-xs text-text outline-none placeholder:text-faint focus:border-accent/50" />
          </div>
          <button onClick={check} disabled={busy} className="rounded-lg border border-accent/40 bg-[color-mix(in_oklch,var(--accent)_14%,transparent)] px-3 text-sm font-medium text-accent disabled:opacity-50">{busy ? '…' : 'Check'}</button>
        </div>
        {!configured && <p className="text-xs text-warn">Add a VirusTotal API key below to enable lookups.</p>}
        {res && (
          <div className="rounded-lg border border-line bg-[var(--bg-2)]/50 p-3">
            {res.error ? (
              <p className="text-sm text-danger">{res.error}</p>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-text">{res.indicator}</span>
                  <Badge color={VERDICT_COLOR[res.verdict]}>{res.verdict}</Badge>
                </div>
                <div className="mt-2 grid grid-cols-4 gap-2 text-center text-xs">
                  <Cnt label="malicious" v={res.malicious} c="var(--danger)" />
                  <Cnt label="suspicious" v={res.suspicious} c="var(--warn)" />
                  <Cnt label="harmless" v={res.harmless} c="var(--good)" />
                  <Cnt label="undetected" v={res.undetected} c="var(--faint)" />
                </div>
                {res.vendors && res.vendors.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {res.vendors.slice(0, 8).map((v, i) => <span key={i} className="rounded border border-danger/30 px-1.5 py-0.5 text-[0.6rem] text-danger" title={v.result}>{v.engine}</span>)}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}

function Cnt({ label, v, c }: { label: string; v: number; c: string }) {
  return (
    <div>
      <div className="stat text-lg font-semibold" style={{ color: v > 0 ? c : 'var(--faint)' }}>{v}</div>
      <div className="text-[0.6rem] text-faint">{label}</div>
    </div>
  );
}

function VtKey({ configured, onSaved }: { configured: boolean; onSaved: () => void }) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      await secSend('POST', '/api/security/vt-key', { key: key.trim() });
      setKey('');
      onSaved();
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel>
      <PanelHeader label="Settings" title="VirusTotal API key" hint={configured ? 'configured ✓' : 'not configured'} right={<KeyRound size={15} className={configured ? 'text-good' : 'text-faint'} />} />
      <div className="flex gap-2 px-5 pb-5 pt-3">
        <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={configured ? 'replace key…' : 'paste your VT API key'} className="flex-1 rounded-lg border border-line bg-[var(--bg-2)] px-3 py-2 font-mono text-xs text-text outline-none placeholder:text-faint focus:border-accent/50" />
        <button onClick={save} disabled={busy || !key.trim()} className="flex items-center gap-1.5 rounded-lg border border-accent/40 bg-[color-mix(in_oklch,var(--accent)_14%,transparent)] px-3 py-2 text-sm font-medium text-accent disabled:opacity-50"><Check size={14} /> Save</button>
      </div>
      <p className="px-5 pb-4 text-[0.66rem] text-faint">Stored encrypted at rest (AES-256-GCM). Free keys at virustotal.com give ~4 lookups/min.</p>
    </Panel>
  );
}
