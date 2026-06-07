'use client';

import { Server, ServerCog, MonitorSmartphone, UsersRound, Boxes, FolderTree } from 'lucide-react';
import type { AdComputer, AdDomainController, DirectorySummary, DirectoryTopology } from '@nexrelm/types';
import { useDir } from '@/lib/directory';
import { num, relTime } from '@/lib/format';
import { Panel, PanelHeader } from '@/components/ui/Panel';
import { Loading } from '@/components/ui/Loading';
import { StatusDot } from '@/components/ui/StatusDot';
import { UsageBar } from '@/components/ui/UsageBar';
import { Mesh } from './Mesh';

function Tile({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number; tone: string }) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-line bg-[var(--bg-2)] p-3.5 transition-colors hover:border-line-strong">
      <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: tone }} />
      <div className="flex items-center gap-1.5 text-faint" style={{ color: tone }}>{icon}<span className="label" style={{ color: 'inherit' }}>{label}</span></div>
      <div className="stat mt-1 text-2xl font-semibold text-text">{num(value)}</div>
    </div>
  );
}

function Pill({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs" style={{ borderColor: `color-mix(in oklch, ${color} 40%, transparent)`, color, background: `color-mix(in oklch, ${color} 10%, transparent)` }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
      {label}
    </span>
  );
}

export function Overview({ onAuthLost }: { onAuthLost: () => void }) {
  const { data: s, loading, error } = useDir<DirectorySummary>('/api/directory/summary', 8000);
  const { data: dcs } = useDir<AdDomainController[]>('/api/directory/dcs', 0);
  const { data: computers } = useDir<AdComputer[]>('/api/directory/computers', 0);

  if (error && /not connected|409/i.test(error)) {
    onAuthLost();
    return null;
  }
  if (loading && !s) return <Loading label="reading the directory" />;
  if (!s) return null;

  const servers = (computers ?? []).filter((c) => c.isServer && !c.isDc);

  return (
    <div className="flex flex-col gap-5">
      <Panel brackets>
        <PanelHeader label="Overview" title="Directory at a glance" hint={`${num(s.dcs)} controller${s.dcs === 1 ? '' : 's'} · ${num(s.computers)} devices`} />
        <div className="grid gap-4 px-5 py-4 lg:grid-cols-[minmax(200px,260px)_1fr]">
          <div className="relative flex flex-col justify-center gap-3 overflow-hidden rounded-xl border border-line bg-[var(--bg-1)]/60 p-4">
            <div className="pointer-events-none absolute -right-6 -top-8 h-24 w-24 rounded-full opacity-20 blur-2xl" style={{ background: 'var(--accent)' }} />
            <div className="flex items-center gap-2">
              <UsersRound size={16} className="text-accent" />
              <span className="stat text-[2.4rem] font-semibold leading-none text-text">{num(s.users)}</span>
              <span className="mb-0.5 self-end text-sm text-muted">users</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Pill color="var(--good)" label={`${num(s.enabledUsers)} enabled`} />
              {s.users - s.enabledUsers > 0 && <Pill color="var(--faint)" label={`${num(s.users - s.enabledUsers)} disabled`} />}
            </div>
            <div>
              <div className="mb-1 flex items-baseline justify-between"><span className="label">Enabled</span><span className="stat text-xs text-text">{s.users ? Math.round((s.enabledUsers / s.users) * 100) : 0}%</span></div>
              <UsageBar ratio={s.users ? s.enabledUsers / s.users : 0} color="var(--good)" height={7} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
            <Tile icon={<Boxes size={14} />} label="Groups" value={s.groups} tone="var(--violet)" />
            <Tile icon={<MonitorSmartphone size={14} />} label="Devices" value={s.computers} tone="var(--accent-dim)" />
            <Tile icon={<Server size={14} />} label="Servers" value={s.servers} tone="var(--warn)" />
            <Tile icon={<ServerCog size={14} />} label="Controllers" value={s.dcs} tone="var(--accent)" />
            <Tile icon={<FolderTree size={14} />} label="Org units" value={s.ous} tone="var(--good)" />
          </div>
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Panel brackets>
          <PanelHeader label="Infrastructure" title="Domain Controllers" hint={`${dcs?.length ?? 0} DC${(dcs?.length ?? 0) === 1 ? '' : 's'}`} />
          <div className="flex flex-col gap-2 px-5 pb-5 pt-3">
            {(dcs ?? []).length === 0 && <p className="text-sm text-faint">none found</p>}
            {(dcs ?? []).map((d) => (
              <div key={d.name} className="panel-2 flex items-center gap-3 px-3 py-2.5">
                <ServerCog size={16} className="text-accent" />
                <div className="min-w-0">
                  <div className="text-sm font-medium text-text">{d.name}</div>
                  <div className="truncate font-mono text-[0.66rem] text-faint">{d.dnsName} {d.os ? `· ${d.os}` : ''}</div>
                </div>
                <StatusDot color="var(--good)" className="ml-auto" />
              </div>
            ))}
          </div>
        </Panel>

        <Panel>
          <PanelHeader label="Infrastructure" title="Servers" hint={`${servers.length} server${servers.length === 1 ? '' : 's'}`} />
          <div className="flex flex-col gap-2 px-5 pb-5 pt-3">
            {servers.length === 0 && <p className="text-sm text-faint">no member servers</p>}
            {servers.map((c) => (
              <div key={c.dn} className="panel-2 flex items-center gap-3 px-3 py-2.5">
                <Server size={16} className="text-warn" />
                <div className="min-w-0">
                  <div className="text-sm font-medium text-text">{c.name}</div>
                  <div className="truncate font-mono text-[0.66rem] text-faint">{c.os ?? 'unknown OS'}{c.lastLogon ? ` · seen ${relTime(c.lastLogon)}` : ''}</div>
                </div>
                <StatusDot color={c.enabled ? 'var(--good)' : 'var(--faint)'} className="ml-auto" pulse={false} />
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}

export function Devices({ onAuthLost, onPickUser }: { onAuthLost: () => void; onPickUser?: (userId: string) => void }) {
  const { data, error } = useDir<AdComputer[]>('/api/directory/computers', 0);
  const { data: topo } = useDir<DirectoryTopology>('/api/directory/topology', 0);
  if (error && /not connected|409/i.test(error)) {
    onAuthLost();
    return null;
  }
  const rows = data ?? [];
  return (
    <div className="flex flex-col gap-5">
      <Panel brackets scanlines>
        <PanelHeader label="Topology" title="Domain mesh" hint="domain → controllers · servers · users → devices · click a node to open the user" />
        <div className="px-3 py-3">
          {topo ? <Mesh topo={topo} onPickUser={onPickUser} /> : <div className="grid h-64 place-items-center text-sm text-faint">mapping the domain…</div>}
        </div>
      </Panel>
      <Panel>
      <PanelHeader label="Devices" title="Domain-joined computers" hint={`${rows.length} device${rows.length === 1 ? '' : 's'}`} />
      <div className="border-t border-line">
        {rows.length === 0 && <div className="px-5 py-8 text-center text-sm text-faint">no computer accounts in the directory yet</div>}
        {rows.map((c) => (
          <div key={c.dn} className="flex flex-wrap items-center gap-3 border-b border-line/50 px-5 py-3 last:border-0">
            <MonitorSmartphone size={16} className={c.isDc ? 'text-accent' : c.isServer ? 'text-warn' : 'text-muted'} />
            <span className="text-sm font-medium text-text">{c.name}</span>
            <span className="font-mono text-[0.66rem] text-faint">{c.dnsName ?? ''}</span>
            <span className="text-xs text-muted">{c.os ?? 'unknown OS'}</span>
            {c.owner && <span className="text-xs text-faint">owner: {c.owner}</span>}
            <StatusDot color={c.enabled ? 'var(--good)' : 'var(--faint)'} className="ml-auto" pulse={false} />
          </div>
        ))}
      </div>
      </Panel>
    </div>
  );
}
