'use client';

import type { DhcpServerStats } from '@nexrelm/types';
import { useDhcp } from '@/lib/dhcp';
import { num, pct } from '@/lib/format';
import { Panel, PanelHeader } from '@/components/ui/Panel';
import { Loading } from '@/components/ui/Loading';
import { Gauge } from '@/components/ui/Gauge';
import { UsageBar } from '@/components/ui/UsageBar';

function Tile({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-line bg-[var(--bg-2)] p-3 transition-colors hover:border-line-strong">
      <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: tone }} />
      <span className="label" style={{ color: tone }}>{label}</span>
      <div className="stat mt-1 text-xl font-semibold text-text">{num(value)}</div>
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

export function Statistics() {
  const { data: s, loading } = useDhcp<DhcpServerStats>('/api/dhcp/stats', 4000);
  if (loading && !s) return <Loading label="loading statistics" />;
  if (!s) return null;

  const tone = s.utilization > 0.85 ? 'var(--danger)' : s.utilization > 0.7 ? 'var(--warn)' : 'var(--accent)';

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        {/* pool hero */}
        <Panel brackets>
          <PanelHeader label="Address Pool" title="Utilization" hint={`${num(s.inUse)} of ${num(s.totalAddresses)} addresses`} />
          <div className="flex flex-col items-center gap-4 px-5 pb-5 pt-2">
            <Gauge ratio={s.utilization} color={tone} label="in use" />
            <div className="flex flex-wrap justify-center gap-2">
              <Pill color="var(--good)" label={`${num(s.inUse)} in use`} />
              <Pill color="var(--accent)" label={`${num(s.available)} free`} />
              {s.reserved > 0 && <Pill color="var(--violet)" label={`${num(s.reserved)} reserved`} />}
            </div>
          </div>
        </Panel>

        <Panel className="xl:col-span-2">
          <PanelHeader label="Messages" title="DHCP message counters" hint="since the server last started" />
          <div className="grid grid-cols-2 gap-3 px-5 pb-5 pt-3 sm:grid-cols-4">
            <Tile label="Discovers" value={s.discovers} tone="var(--accent)" />
            <Tile label="Offers" value={s.offers} tone="var(--accent-dim)" />
            <Tile label="Requests" value={s.requests} tone="var(--violet)" />
            <Tile label="ACKs" value={s.acks} tone="var(--good)" />
            <Tile label="NAKs" value={s.naks} tone="var(--danger)" />
            <Tile label="Declines" value={s.declines} tone="var(--warn)" />
            <Tile label="Releases" value={s.releases} tone="var(--faint)" />
            <Tile label="Informs" value={s.informs} tone="var(--faint)" />
          </div>
        </Panel>
      </div>

      <Panel>
        <PanelHeader label="Scopes" title="Per-scope utilization" hint={`${s.scopes} scope${s.scopes === 1 ? '' : 's'}`} />
        <div className="grid grid-cols-1 gap-3 px-5 pb-5 pt-3 lg:grid-cols-2">
          {s.perScope.length === 0 && <p className="text-sm text-faint">No scopes yet — create one in the Scopes tab.</p>}
          {s.perScope.map((p) => {
            const t = p.utilization > 0.85 ? 'var(--danger)' : p.utilization > 0.7 ? 'var(--warn)' : 'var(--accent)';
            return (
              <div key={p.scopeId} className="relative overflow-hidden rounded-xl border border-line bg-[var(--bg-2)] p-3.5 transition-colors hover:border-line-strong">
                <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: t }} />
                <div className="mb-1.5 flex items-baseline justify-between">
                  <span className="text-sm font-medium text-text">{p.name}</span>
                  <span className="label">{num(p.inUse)} / {num(p.total)} · {pct(p.utilization)}</span>
                </div>
                <UsageBar ratio={p.utilization} color={t} height={8} />
              </div>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}
