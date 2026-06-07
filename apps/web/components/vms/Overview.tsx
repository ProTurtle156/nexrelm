'use client';

import { useState } from 'react';
import { RotateCw, TerminalSquare, Server, MemoryStick, HardDrive } from 'lucide-react';
import type { VmMachine } from '@nexrelm/types';
import { useVm, vmSend, fmtKb, ratio } from '@/lib/vms';
import { cn, uptime, relTime } from '@/lib/format';
import { Panel, PanelHeader } from '@/components/ui/Panel';
import { StatusDot } from '@/components/ui/StatusDot';
import { UsageBar } from '@/components/ui/UsageBar';

export function VmOverview({ onOpenTerminal, onManage }: { onOpenTerminal: (id: string) => void; onManage: () => void }) {
  const { data, refresh } = useVm<VmMachine[]>('/api/vms', 10000);
  const [busy, setBusy] = useState(false);
  const vms = data ?? [];

  async function refreshAll() {
    setBusy(true);
    try {
      await vmSend('POST', '/api/vms/refresh');
      refresh();
    } finally {
      setBusy(false);
    }
  }

  const reachable = vms.filter((v) => v.stats?.reachable);
  const cores = reachable.reduce((a, v) => a + (v.stats?.cpuCores ?? 0), 0);
  const memTotal = reachable.reduce((a, v) => a + (v.stats?.memTotalKb ?? 0), 0);
  const memUsed = reachable.reduce((a, v) => a + (v.stats?.memUsedKb ?? 0), 0);
  const diskTotal = reachable.reduce((a, v) => a + (v.stats?.disks?.reduce((b, d) => b + d.sizeKb, 0) ?? 0), 0);
  const diskUsed = reachable.reduce((a, v) => a + (v.stats?.disks?.reduce((b, d) => b + d.usedKb, 0) ?? 0), 0);
  const avgCpu = reachable.length ? Math.round(reachable.reduce((a, v) => a + (v.stats?.cpuPct ?? 0), 0) / reachable.length) : 0;
  const avgLoad = reachable.length ? reachable.reduce((a, v) => a + (v.stats?.load1 ?? 0), 0) / reachable.length : 0;
  const down = vms.length - reachable.length;

  if (vms.length === 0) {
    return (
      <Panel brackets>
        <PanelHeader label="Overview" title="Virtualization" hint="no VMs registered" />
        <div className="flex flex-col items-center gap-3 px-5 py-12 text-center">
          <Server size={28} className="text-faint" />
          <p className="max-w-sm text-sm text-muted">Register your VMs with their SSH host and credentials to see live stats here and drop into a terminal on any of them.</p>
          <button onClick={onManage} className="rounded-lg border border-accent/40 bg-[color-mix(in_oklch,var(--accent)_14%,transparent)] px-4 py-2 text-sm font-medium text-accent">Go to VMs →</button>
        </div>
      </Panel>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {/* fleet hero */}
      <Panel brackets>
        <PanelHeader
          label="Overview"
          title="Fleet at a glance"
          hint={`${reachable.length}/${vms.length} reachable`}
          right={<button onClick={refreshAll} disabled={busy} className="flex items-center gap-1.5 rounded-lg border border-accent/40 bg-[color-mix(in_oklch,var(--accent)_14%,transparent)] px-3 py-1.5 text-xs font-medium text-accent disabled:opacity-50"><RotateCw size={13} className={busy ? 'animate-spin' : ''} /> Refresh all</button>}
        />
        <div className="grid gap-4 px-5 py-4 lg:grid-cols-[minmax(190px,250px)_1fr]">
          {/* status block */}
          <div className="relative flex flex-col justify-center gap-3 overflow-hidden rounded-xl border border-line bg-[var(--bg-1)]/60 p-4">
            <div className="pointer-events-none absolute -right-6 -top-8 h-24 w-24 rounded-full opacity-20 blur-2xl" style={{ background: down ? 'var(--danger)' : 'var(--accent)' }} />
            <div className="flex items-end gap-2">
              <span className="stat text-[2.6rem] font-semibold leading-none text-text">{vms.length}</span>
              <span className="mb-1 text-sm text-muted">VM{vms.length === 1 ? '' : 's'}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Pill color="var(--good)" label={`${reachable.length} up`} />
              {down > 0 && <Pill color="var(--danger)" label={`${down} down`} />}
            </div>
            <div className="text-xs text-faint">{cores} vCPU cores{reachable.length ? ` · avg load ${avgLoad.toFixed(2)}` : ''}</div>
          </div>

          {/* utilization gauges */}
          <div className="grid gap-4 sm:grid-cols-3">
            <FleetGauge label="Avg CPU" pct={avgCpu} detail={`across ${reachable.length} reachable`} />
            <FleetGauge label="Memory" pct={memTotal ? Math.round(ratio(memUsed, memTotal) * 100) : undefined} detail={`${fmtKb(memUsed)} / ${fmtKb(memTotal)}`} color="var(--violet)" />
            <FleetGauge label="Disk" pct={diskTotal ? Math.round(ratio(diskUsed, diskTotal) * 100) : undefined} detail={`${fmtKb(diskUsed)} / ${fmtKb(diskTotal)}`} color="var(--accent-dim)" />
          </div>
        </div>
      </Panel>

      {/* per-VM cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {vms.map((vm) => (
          <VmCard key={vm.id} vm={vm} onOpenTerminal={onOpenTerminal} />
        ))}
      </div>
    </div>
  );
}

function VmCard({ vm, onOpenTerminal }: { vm: VmMachine; onOpenTerminal: (id: string) => void }) {
  const s = vm.stats;
  const up = s?.reachable;
  const disk = s?.disks?.[0];
  const memPct = s?.memTotalKb ? Math.round(ratio(s.memUsedKb, s.memTotalKb) * 100) : undefined;

  return (
    <div
      onClick={() => up && onOpenTerminal(vm.id)}
      className={cn(
        'group relative overflow-hidden rounded-xl border bg-[var(--bg-2)] transition-all duration-200',
        up ? 'cursor-pointer border-line hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-[0_10px_34px_-16px_var(--accent)]' : 'border-danger/25',
      )}
    >
      <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: up ? 'linear-gradient(180deg, var(--good), var(--accent))' : 'var(--danger)' }} />

      <div className="flex items-start gap-2.5 px-4 pt-3.5">
        <StatusDot color={up ? 'var(--good)' : up === false ? 'var(--danger)' : 'var(--faint)'} pulse={up} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-text">{vm.name}</div>
          <div className="truncate font-mono text-[0.66rem] text-faint">{vm.username}@{vm.host}:{vm.port}</div>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onOpenTerminal(vm.id); }}
          className="grid h-7 w-7 place-items-center rounded-lg border border-line text-muted transition-colors hover:border-accent/40 hover:text-accent"
          title="open terminal"
        >
          <TerminalSquare size={14} />
        </button>
      </div>

      {up ? (
        <>
          <div className="flex items-center gap-4 px-4 py-3.5">
            <Ring pct={s?.cpuPct} />
            <div className="flex min-w-0 flex-1 flex-col gap-2.5">
              <BarRow icon={<MemoryStick size={12} />} label="MEM" pct={memPct} color="var(--violet)" sub={s?.memTotalKb ? `${fmtKb(s.memUsedKb)} / ${fmtKb(s.memTotalKb)}` : undefined} />
              {disk ? <BarRow icon={<HardDrive size={12} />} label={disk.mount} pct={disk.usePct} sub={`${fmtKb(disk.usedKb)} / ${fmtKb(disk.sizeKb)}`} /> : <div className="text-[0.66rem] text-faint">no disk data</div>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-line/60 px-4 py-2.5 text-[0.66rem] text-faint">
            <span className="truncate text-muted">{s?.os ?? 'unknown OS'}</span>
            {s?.uptimeSec != null && <span>· up {uptime(s.uptimeSec)}</span>}
            {s?.cpuCores != null && <span>· {s.cpuCores} cores</span>}
            {vm.tags?.length ? <span className="ml-auto flex flex-wrap gap-1">{vm.tags.slice(0, 3).map((t) => <span key={t} className="rounded-full border border-line px-1.5 py-px text-[0.6rem] text-muted">{t}</span>)}</span> : <span className="ml-auto">{vm.lastChecked ? relTime(vm.lastChecked) : ''}</span>}
          </div>
        </>
      ) : (
        <div className="px-4 py-4 text-xs text-danger">unreachable{s?.error ? ` — ${s.error}` : ''}</div>
      )}
    </div>
  );
}

function Ring({ pct, size = 56 }: { pct?: number; size?: number }) {
  const stroke = 5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(100, pct ?? 0));
  const col = p > 90 ? 'var(--danger)' : p > 75 ? 'var(--warn)' : 'var(--accent)';
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line-strong)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={col} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - p / 100)} style={{ transition: 'stroke-dashoffset .7s ease', filter: `drop-shadow(0 0 4px ${col})` }} />
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <div className="text-center leading-none">
          <div className="stat text-sm font-semibold text-text">{pct != null ? `${pct}` : '—'}</div>
          <div className="text-[0.55rem] text-faint">CPU%</div>
        </div>
      </div>
    </div>
  );
}

function BarRow({ icon, label, pct, sub, color }: { icon: React.ReactNode; label: string; pct?: number; sub?: string; color?: string }) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5 text-[0.66rem]">
        <span className="text-faint">{icon}</span>
        <span className="truncate font-mono text-muted">{label}</span>
        <span className={cn('stat ml-auto', pct != null && pct > 90 ? 'text-danger' : 'text-text')}>{pct != null ? `${pct}%` : '—'}</span>
      </div>
      <UsageBar ratio={(pct ?? 0) / 100} color={color} />
      {sub && <div className="mt-0.5 truncate text-[0.6rem] text-faint">{sub}</div>}
    </div>
  );
}

function FleetGauge({ label, pct, detail, color }: { label: string; pct?: number; detail?: string; color?: string }) {
  return (
    <div className="rounded-xl border border-line bg-[var(--bg-1)]/40 p-3.5">
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="label">{label}</span>
        <span className="stat text-lg font-semibold text-text">{pct != null ? `${pct}%` : '—'}</span>
      </div>
      <UsageBar ratio={(pct ?? 0) / 100} color={color} height={8} />
      {detail && <div className="mt-1.5 truncate text-[0.66rem] text-faint">{detail}</div>}
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
