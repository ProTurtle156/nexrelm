'use client';

import { useState } from 'react';
import { Monitor, Laptop, Smartphone, Terminal, Router, HelpCircle, Activity, Radio } from 'lucide-react';
import type { ClientOs, SecurityAlert, SecurityOverview } from '@nexrelm/types';
import { useSec, secSend, STATUS_COLOR, SEV_COLOR } from '@/lib/security';
import { num, compact, hms, cn } from '@/lib/format';
import { Panel, PanelHeader } from '@/components/ui/Panel';
import { Loading } from '@/components/ui/Loading';
import { Gauge } from '@/components/ui/Gauge';
import { UsageBar } from '@/components/ui/UsageBar';
import { StatusDot } from '@/components/ui/StatusDot';

const OS_META: Record<ClientOs, { icon: typeof Monitor; label: string; color: string }> = {
  windows: { icon: Monitor, label: 'Windows', color: 'var(--accent)' },
  macos: { icon: Laptop, label: 'macOS', color: 'var(--muted)' },
  linux: { icon: Terminal, label: 'Linux', color: 'var(--warn)' },
  ios: { icon: Smartphone, label: 'iPhone / iPad', color: 'var(--violet)' },
  android: { icon: Smartphone, label: 'Android', color: 'var(--good)' },
  network: { icon: Router, label: 'Network / IoT', color: 'var(--accent-dim)' },
  other: { icon: HelpCircle, label: 'Other', color: 'var(--faint)' },
};

export function SecOverview() {
  const { data: o, loading } = useSec<SecurityOverview>('/api/security/overview?window=300', 4000);
  const { data: feed } = useSec<SecurityAlert[]>('/api/security/feed?limit=80', 3000);

  if (loading && !o) return <Loading label="evaluating posture" />;
  if (!o) return null;

  const scoreColor = o.postureScore >= 80 ? 'var(--good)' : o.postureScore >= 60 ? 'var(--warn)' : 'var(--danger)';
  const maxCount = Math.max(1, ...o.clientsByOs.map((c) => c.count));

  return (
    <div className="flex flex-col gap-5">
      {/* hero */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[300px_1fr]">
        <Panel brackets>
          <PanelHeader label="Posture" title="Security score" hint={`${o.activeAlerts} active alert${o.activeAlerts === 1 ? '' : 's'}`} />
          <div className="flex flex-col items-center gap-3 px-5 pb-5 pt-2">
            <Gauge ratio={o.postureScore / 100} color={scoreColor} label="score" />
            <div className="flex flex-wrap justify-center gap-2">
              <Pill color="var(--good)" label={`${compact(o.access)} access`} />
              <Pill color="var(--danger)" label={`${compact(o.blocked)} blocked`} />
              {o.activeAlerts > 0 && <Pill color="var(--warn)" label={`${o.activeAlerts} alerts`} />}
            </div>
          </div>
        </Panel>

        <Panel>
          <PanelHeader label="Live traffic" title="Traffic rate & disposition" hint={`${num(o.totalQueries)} events · last ${Math.round(o.windowSec / 60)}m`} right={<span className="flex items-center gap-1.5 text-xs text-muted"><Activity size={13} className="text-accent" /> {o.qps}/s</span>} />
          <div className="px-5 pb-3 pt-2"><Spark series={o.series} /></div>
          <div className="grid grid-cols-2 gap-3 px-5 pb-5 sm:grid-cols-4">
            <Stat label="Events/sec" value={String(o.qps)} accent="var(--accent)" />
            <Stat label="Clients" value={num(o.uniqueClients)} accent="var(--violet)" />
            <Stat label="Access" value={compact(o.access)} accent="var(--good)" />
            <Stat label="Block rate" value={`${Math.round(o.blockRate * 100)}%`} accent={o.blockRate > 0.3 ? 'var(--warn)' : 'var(--danger)'} />
          </div>
        </Panel>
      </div>

      {/* clients by OS + response status */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Panel>
          <PanelHeader label="Clients" title="Devices by platform" hint={`${o.clientsByOs.reduce((a, c) => a + c.count, 0)} devices`} />
          <div className="flex flex-col gap-2.5 px-5 pb-5 pt-3">
            {o.clientsByOs.length === 0 && <p className="text-sm text-faint">no clients seen yet</p>}
            {o.clientsByOs.map((c) => {
              const m = OS_META[c.os];
              const Icon = m.icon;
              return (
                <div key={c.os} className="flex items-center gap-3">
                  <Icon size={16} style={{ color: m.color }} />
                  <span className="w-28 text-sm text-text">{m.label}</span>
                  <UsageBar ratio={c.count / maxCount} color={m.color} className="flex-1" />
                  <span className="stat w-10 text-right text-xs text-muted">{c.count}</span>
                </div>
              );
            })}
          </div>
        </Panel>

        <Panel>
          <PanelHeader label="Responses" title="Query disposition" hint="how the resolver answered" />
          <div className="flex flex-col gap-2.5 px-5 pb-5 pt-3">
            {o.statusBreakdown.map((s) => {
              const total = o.statusBreakdown.reduce((a, x) => a + x.count, 0) || 1;
              return (
                <div key={s.status} className="flex items-center gap-3">
                  <span className="flex w-24 items-center gap-2 text-sm text-text"><span className="h-2 w-2 rounded-full" style={{ background: STATUS_COLOR[s.status] }} />{s.status}</span>
                  <UsageBar ratio={s.count / total} color={STATUS_COLOR[s.status]} className="flex-1" />
                  <span className="stat w-14 text-right text-xs text-muted">{num(s.count)}</span>
                </div>
              );
            })}
          </div>
        </Panel>
      </div>

      <Sniffer />

      {/* live threat feed */}
      <Panel scanlines>
        <PanelHeader label="Live feed" title="Threat event stream" hint="info → critical · from the heuristic engine" right={<StatusDot color="var(--good)" />} />
        <div className="max-h-[360px] overflow-y-auto px-5 pb-4 pt-1 text-xs no-scrollbar">
          {(feed ?? []).map((e) => (
            <div key={e.id} className="flex items-start gap-3 border-b border-line/40 py-2 last:border-0">
              <span className="w-14 shrink-0 font-mono text-faint">{hms(e.ts)}</span>
              <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: SEV_COLOR[e.severity], boxShadow: `0 0 6px ${SEV_COLOR[e.severity]}` }} />
              <span className="w-16 shrink-0 text-right text-[0.66rem] font-semibold uppercase" style={{ color: SEV_COLOR[e.severity] }}>{e.severity}</span>
              <span className="min-w-0 flex-1">
                <span className="text-text">{e.title}</span>
                <span className="ml-2 font-mono text-[0.62rem] text-faint">{e.source}</span>
              </span>
              <span className="hidden shrink-0 text-[0.62rem] text-faint sm:block">{e.kind.replace(/_/g, ' ')}</span>
            </div>
          ))}
          {(feed ?? []).length === 0 && <p className="py-8 text-center text-faint">No threats detected — all clear. Events appear here as the heuristic engine flags activity.</p>}
        </div>
      </Panel>
    </div>
  );
}

interface SnifferState { running: boolean; iface: string; packets: number; error?: string; topTalkers: Array<{ ip: string; packets: number }>; topFlows: Array<{ src: string; dst: string; dport: number; proto: string; packets: number }> }
function Sniffer() {
  const { data, refresh } = useSec<SnifferState>('/api/security/sniffer', 3000);
  const [busy, setBusy] = useState(false);
  async function toggle() {
    setBusy(true);
    try {
      await secSend('POST', '/api/security/sniffer', { action: data?.running ? 'stop' : 'start' });
      refresh();
    } finally {
      setBusy(false);
    }
  }
  const max = Math.max(1, ...(data?.topTalkers ?? []).map((t) => t.packets));
  return (
    <Panel>
      <PanelHeader
        label="Capture"
        title="Network sniffer"
        hint={data?.running ? `promiscuous on ${data.iface} · ${num(data.packets)} packets` : 'passively grep flows off the wire'}
        right={<button onClick={toggle} disabled={busy} className={cn('flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium disabled:opacity-50', data?.running ? 'border-danger/40 text-danger' : 'border-accent/40 bg-[color-mix(in_oklch,var(--accent)_14%,transparent)] text-accent')}><Radio size={13} className={data?.running ? 'animate-pulse' : ''} /> {data?.running ? 'Stop' : 'Start capture'}</button>}
      />
      {data?.error && <p className="px-5 pb-2 text-xs text-warn">{data.error}</p>}
      {data?.running ? (
        <div className="grid grid-cols-1 gap-5 px-5 pb-5 pt-2 lg:grid-cols-2">
          <div>
            <div className="label mb-1.5">Top talkers</div>
            {(data.topTalkers ?? []).slice(0, 8).map((t) => (
              <div key={t.ip} className="flex items-center gap-2 py-0.5"><span className="w-32 truncate font-mono text-xs text-text">{t.ip}</span><UsageBar ratio={t.packets / max} className="flex-1" /><span className="stat w-12 text-right text-xs text-muted">{num(t.packets)}</span></div>
            ))}
          </div>
          <div>
            <div className="label mb-1.5">Top flows</div>
            {(data.topFlows ?? []).slice(0, 8).map((f, i) => (
              <div key={i} className="flex items-center gap-2 py-0.5 font-mono text-[0.66rem]"><span className="min-w-0 flex-1 truncate text-muted">{f.src} → {f.dst}:{f.dport}</span><span className="text-faint">{f.proto}</span><span className="stat w-8 text-right text-faint">{f.packets}</span></div>
            ))}
          </div>
        </div>
      ) : (
        <p className="px-5 pb-5 pt-1 text-xs text-faint">Off by default. When started, Nexrelm puts its interface in promiscuous mode and reads packet headers to map who's talking to whom — every internal IP it sees becomes a client in the inventory and the platform breakdown. On a switched LAN it sees broadcasts + this host's traffic (and <span className="text-muted">all client traffic once Nexrelm is the gateway</span> — see the inline-gateway phase). To list every device on your subnet right now, run <span className="text-muted">Discover network</span> in the Vulnerabilities tab.</p>
      )}
    </Panel>
  );
}

function Spark({ series }: { series: SecurityOverview['series'] }) {
  const W = 800;
  const H = 64;
  const max = Math.max(1, ...series.map((p) => p.total));
  const x = (i: number) => (series.length > 1 ? (i / (series.length - 1)) * W : 0);
  const yT = (v: number) => H - (v / max) * H;
  const line = series.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${yT(p.total).toFixed(1)}`).join(' ');
  const area = `${line} L${W} ${H} L0 ${H} Z`;
  const blockLine = series.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${yT(p.blocked).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" className="overflow-visible">
      <defs>
        <linearGradient id="secspark" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#secspark)" />
      <path d={line} fill="none" stroke="var(--accent)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      <path d={blockLine} fill="none" stroke="var(--danger)" strokeWidth="1.5" strokeOpacity="0.8" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className="stat mt-1 text-xl font-semibold" style={accent ? { color: accent } : undefined}>{value}</div>
    </div>
  );
}

function Pill({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs" style={{ borderColor: `color-mix(in oklch, ${color} 40%, transparent)`, color, background: `color-mix(in oklch, ${color} 10%, transparent)` }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} /> {label}
    </span>
  );
}
