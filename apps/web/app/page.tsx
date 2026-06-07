'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Globe, Network, Rocket, Router, Server, ShieldHalf, UsersRound, X, type LucideIcon } from 'lucide-react';
import type {
  DhcpServerStats,
  DhcpServerStatus,
  DirectoryStatus,
  DirectorySummary,
  DnsResolverStats,
  LogLine,
  NetworkPosture,
  SecurityAlert,
  SecurityOverview,
  Topology,
} from '@nexrelm/types';
import { useDns } from '@/lib/dns';
import { num, relTime } from '@/lib/format';
import { severityVar } from '@/lib/ui';
import { Panel, PanelHeader } from '@/components/ui/Panel';
import { Loading } from '@/components/ui/Loading';
import { TopologyGraph } from '@/components/topology/TopologyGraph';
import { Inspector, Legend } from '@/components/topology/Inspector';
import { NodeSections } from '@/components/topology/NodeSections';
import { ActivityChart } from '@/components/dns/ActivityChart';

/**
 * The Nexrelm command deck — every number on this page is live module state,
 * with the real network map (gateway + AD + inventory + VMs) at the centre.
 */
export default function DashboardPage() {
  const { data: topology } = useDns<Topology>('/api/topology', 5000);
  const { data: dns } = useDns<DnsResolverStats>('/api/dns/stats', 5000);
  const { data: dhcp } = useDns<DhcpServerStats>('/api/dhcp/stats', 10000);
  const { data: dhcpStatus } = useDns<DhcpServerStatus>('/api/dhcp/status', 10000);
  const { data: sec } = useDns<SecurityOverview>('/api/security/overview', 10000);
  const { data: feed } = useDns<SecurityAlert[]>('/api/security/feed?limit=30', 5000);
  const { data: posture } = useDns<NetworkPosture>('/api/security/network', 10000);
  const { data: dirStatus } = useDns<DirectoryStatus>('/api/directory/status', 15000);
  const { data: dir } = useDns<DirectorySummary>('/api/directory/summary', 30000); // null while disconnected (409)
  const { data: logs } = useDns<LogLine[]>('/api/logs?limit=10', 3000);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (!topology) return <Loading label="booting nexrelm" />;

  const selected = topology.nodes.find((n) => n.id === selectedId) ?? null;
  const online = topology.nodes.filter((n) => n.status === 'online').length;
  const vms = topology.nodes.filter((n) => n.kind === 'vm');
  const vmsUp = vms.filter((v) => v.status === 'online').length;
  const threats = sec?.activeAlerts ?? 0;
  const dcNode = topology.nodes.find((n) => n.meta?.role === 'Domain Controller');
  const domain = typeof dcNode?.meta?.domain === 'string' ? dcNode.meta.domain : undefined;
  const gwMode = posture?.gateway.mode ?? 'off';

  const kpis: Array<{ label: string; value: string; sub?: string; tone: string }> = [
    { label: 'DNS queries · 24h', value: num(dns?.totalQueries ?? 0), sub: dns ? `${num(dns.blocked)} blocked · ${dns.blockedPct}%` : 'resolver idle', tone: 'var(--accent)' },
    { label: 'Active threats', value: String(threats), sub: sec ? `posture ${sec.postureScore}/100` : '—', tone: threats > 0 ? 'var(--danger)' : 'var(--good)' },
    { label: 'DHCP leases', value: num(dhcp?.inUse ?? 0), sub: dhcpStatus?.running ? `${num(dhcp?.available ?? 0)} free · serving` : 'server stopped', tone: 'var(--warn)' },
    { label: 'Nodes online', value: String(online), sub: `of ${topology.nodes.length} mapped`, tone: 'var(--good)' },
    { label: 'AD users', value: dir ? num(dir.users) : '—', sub: dirStatus?.connected ? (dirStatus.domain ?? 'connected') : 'not connected', tone: 'var(--violet)' },
    { label: 'VMs reachable', value: String(vmsUp), sub: `of ${vms.length} managed`, tone: 'var(--accent-dim)' },
  ];

  const modules: ModuleTileProps[] = [
    { href: '/dns', icon: Globe, label: 'DNS', active: !!posture?.dns.active || (dns?.totalQueries ?? 0) > 0, headline: dns ? `${num(dns.totalQueries)} queries · ${num(dns.uniqueClients)} clients` : 'loading…' },
    { href: '/dhcp', icon: Router, label: 'DHCP', active: !!dhcpStatus?.running, headline: dhcpStatus?.running ? `serving · ${num(dhcp?.inUse ?? 0)}/${num(dhcp?.totalAddresses ?? 0)} leased` : 'stopped' },
    { href: '/directory', icon: UsersRound, label: 'Directory', active: !!dirStatus?.connected, headline: dirStatus?.connected ? `${dirStatus.domain ?? 'domain'} · ${dir ? `${num(dir.computers)} computers` : '…'}` : 'not connected' },
    { href: '/security', icon: ShieldHalf, label: 'Security', active: true, tone: threats > 0 ? 'var(--danger)' : 'var(--good)', headline: `${threats} active alert${threats === 1 ? '' : 's'} · posture ${sec?.postureScore ?? '—'}` },
    { href: '/gateway', icon: Network, label: 'Gateway', active: gwMode !== 'off', headline: gwMode !== 'off' ? `routing · mode ${gwMode}` : 'off — node only' },
    { href: '/virtualization', icon: Server, label: 'Virtualization', active: vmsUp > 0, headline: `${vmsUp}/${vms.length} VMs reachable` },
  ];

  // not on the path yet → invite the operator into the guided wizard
  const integrated = !!posture && (posture.dns.active || posture.dhcp.active || posture.capture.active || posture.gateway.enabled);
  const showOnboard = !!posture && !integrated;

  return (
    <div className="flex flex-col gap-5">
      {showOnboard && <OnboardBanner />}

      {/* live KPIs */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {kpis.map((k) => (
          <Kpi key={k.label} {...k} />
        ))}
      </div>

      {/* module status strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {modules.map((m) => (
          <ModuleTile key={m.href} {...m} />
        ))}
      </div>

      {/* live network map + inspector / alerts */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Panel brackets className="xl:col-span-2">
          <PanelHeader
            label="Topology"
            title="Live network map"
            hint={`${domain ? `${domain} · ` : ''}${online}/${topology.nodes.length} online`}
            right={
              selected && (
                <button onClick={() => setSelectedId(null)} className="text-xs text-accent hover:underline">
                  clear
                </button>
              )
            }
          />
          <div className="px-4 pb-4 pt-2">
            <TopologyGraph topology={topology} selectedId={selectedId} onSelect={setSelectedId} className="max-w-[760px]" />
          </div>
          <div className="flex items-center gap-5 border-t border-line px-5 py-3">
            <Legend color="var(--good)" label="online" />
            <Legend color="var(--warn)" label="degraded" />
            <Legend color="var(--danger)" label="offline" />
            <span className="ml-auto text-xs text-faint">click a node to inspect</span>
          </div>
        </Panel>

        {selected ? <Inspector node={selected} topology={topology} /> : <AlertsFeed alerts={feed ?? []} />}
      </div>

      {/* DNS activity + event log */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Panel className="xl:col-span-2">
          <PanelHeader
            label="Activity"
            title="DNS queries · last 24 hours"
            hint="total (cyan) vs blocked (red)"
            right={
              <Link href="/dns" className="flex items-center gap-1 text-xs text-accent hover:underline">
                resolver <ArrowUpRight size={13} />
              </Link>
            }
          />
          <div className="px-3 pb-4 pt-2">
            {dns ? <ActivityChart data={dns.series} height={190} /> : <div className="grid h-[190px] place-items-center text-xs text-faint">loading query history…</div>}
          </div>
        </Panel>

        <LogsPanel logs={logs ?? []} />
      </div>

      {/* categorized inventory */}
      <NodeSections topology={topology} selectedId={selectedId} onSelect={setSelectedId} />
    </div>
  );
}

function OnboardBanner() {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <div className="panel relative flex items-center gap-4 overflow-hidden px-5 py-4" style={{ borderColor: 'color-mix(in oklch, var(--accent) 35%, transparent)' }}>
      <span className="pointer-events-none absolute inset-0 opacity-50" style={{ background: 'radial-gradient(36rem 12rem at 0% 0%, color-mix(in oklch, var(--accent) 14%, transparent), transparent 70%)' }} />
      <span className="relative grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-accent/40 text-accent" style={{ background: 'color-mix(in oklch, var(--accent) 12%, transparent)' }}>
        <Rocket size={20} strokeWidth={1.6} />
      </span>
      <div className="relative min-w-0 flex-1">
        <div className="text-sm font-semibold text-text">Nexrelm isn't on your network's path yet</div>
        <div className="text-xs text-muted">Run the 5-step guided setup to point your network at Nexrelm and light up DNS, blocking, capture and enforcement — network-wide.</div>
      </div>
      <Link href="/onboarding" className="relative shrink-0 rounded-lg border border-accent/40 bg-[color-mix(in_oklch,var(--accent)_16%,transparent)] px-4 py-2 text-sm font-medium text-accent">
        Start setup
      </Link>
      <button onClick={() => setDismissed(true)} className="relative shrink-0 text-faint hover:text-text" aria-label="Dismiss">
        <X size={16} />
      </button>
    </div>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone: string }) {
  return (
    <div className="panel-2 relative flex flex-col gap-1 overflow-hidden px-4 py-3">
      <span className="label">{label}</span>
      <span className="stat text-2xl font-semibold tracking-tight" style={{ color: tone }}>
        {value}
      </span>
      {sub && <span className="truncate text-xs text-faint">{sub}</span>}
      <span className="pointer-events-none absolute inset-x-0 bottom-0 h-px opacity-60" style={{ background: `linear-gradient(90deg, transparent, ${tone}, transparent)` }} />
    </div>
  );
}

interface ModuleTileProps {
  href: string;
  icon: LucideIcon;
  label: string;
  active: boolean;
  headline: string;
  tone?: string;
}

function ModuleTile({ href, icon: Icon, label, active, headline, tone }: ModuleTileProps) {
  const color = tone ?? (active ? 'var(--good)' : 'var(--faint)');
  return (
    <Link href={href} className="panel-2 group flex items-center gap-3 px-4 py-3 transition-colors hover:border-accent/40">
      <span
        className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border"
        style={{ color, borderColor: `color-mix(in oklch, ${color} 40%, transparent)`, background: `color-mix(in oklch, ${color} 10%, var(--bg-2))` }}
      >
        <Icon size={16} strokeWidth={1.7} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-sm font-medium text-text">
          {label}
          <ArrowUpRight size={12} className="text-faint opacity-0 transition-opacity group-hover:opacity-100" />
        </span>
        <span className="block truncate text-xs text-muted">{headline}</span>
      </span>
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
    </Link>
  );
}

function AlertsFeed({ alerts }: { alerts: SecurityAlert[] }) {
  return (
    <Panel>
      <PanelHeader
        label="Security"
        title="Live alerts"
        hint={alerts.length ? `${alerts.length} recent detections` : 'no recent detections'}
        right={
          <Link href="/security" className="text-xs text-accent hover:underline">
            all
          </Link>
        }
      />
      <div className="flex max-h-[460px] flex-col gap-1 overflow-y-auto px-3 pb-3 pt-1">
        {alerts.length === 0 && <div className="px-2 py-10 text-center text-sm text-faint">all quiet — no threats detected</div>}
        {alerts.slice(0, 14).map((a) => {
          const color = severityVar(a.severity);
          return (
            <div key={a.id} className="rounded-lg border border-line/60 bg-[var(--bg-2)]/40 px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-text">{a.title}</span>
                <span className="shrink-0 text-[0.64rem] text-faint">{relTime(a.ts)}</span>
              </div>
              <div className="mt-0.5 flex items-center gap-2 pl-4 text-[0.66rem] text-muted">
                <span className="font-mono">{a.source}</span>
                {a.response && <span className="text-warn">{a.response}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

function LogsPanel({ logs }: { logs: LogLine[] }) {
  const lvl = (l: string): string => (l === 'error' ? 'var(--danger)' : l === 'warn' ? 'var(--warn)' : 'var(--faint)');
  return (
    <Panel scanlines>
      <PanelHeader
        label="Event log"
        title="Live stream"
        right={
          <Link href="/logs" className="text-xs text-accent hover:underline">
            console
          </Link>
        }
      />
      <div className="flex flex-col gap-1.5 px-4 pb-4 pt-1 font-mono text-[0.7rem]">
        {logs.length === 0 && <span className="py-6 text-center text-faint">no events yet</span>}
        {logs.map((l) => (
          <div key={l.id} className="flex items-baseline gap-2">
            <span className="shrink-0 text-faint">{new Date(l.ts).toLocaleTimeString('en-GB')}</span>
            <span className="shrink-0 uppercase tracking-wider" style={{ color: lvl(l.level) }}>
              {l.stream}
            </span>
            <span className="min-w-0 truncate text-muted">{l.msg}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}
