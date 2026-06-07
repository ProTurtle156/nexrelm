'use client';

import { useState } from 'react';
import { Plus, Trash2, RotateCw, TerminalSquare, ChevronRight, ChevronDown, Save, Server } from 'lucide-react';
import type { VmMachine, VmMachineStats } from '@nexrelm/types';
import { useVm, vmSend, fmtKb, ratio } from '@/lib/vms';
import { cn, relTime, uptime } from '@/lib/format';
import { Panel, PanelHeader } from '@/components/ui/Panel';
import { Badge } from '@/components/ui/Badge';
import { StatusDot } from '@/components/ui/StatusDot';
import { UsageBar } from '@/components/ui/UsageBar';

const cls = 'rounded-lg border border-line bg-[var(--bg-2)] px-3 py-2 text-sm text-text outline-none placeholder:text-faint focus:border-accent/50';

export function VmList({ onOpenTerminal }: { onOpenTerminal: (id: string) => void }) {
  const { data, refresh } = useVm<VmMachine[]>('/api/vms', 0);
  const [adding, setAdding] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function act(id: string, fn: () => Promise<unknown>) {
    setBusy(id);
    setErr(null);
    try {
      await fn();
      refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'operation failed');
    } finally {
      setBusy(null);
    }
  }

  const vms = data ?? [];

  return (
    <Panel>
      <PanelHeader
        label="VMs"
        title="Registered machines"
        hint={`${vms.length} VM${vms.length === 1 ? '' : 's'} · click one for full detail`}
        right={<button onClick={() => setAdding((a) => !a)} className="flex items-center gap-1.5 rounded-lg border border-accent/40 bg-[color-mix(in_oklch,var(--accent)_14%,transparent)] px-3 py-1.5 text-xs font-medium text-accent"><Plus size={14} /> Add VM</button>}
      />
      {err && <div className="mx-5 mb-1 rounded-lg border border-danger/30 bg-[color-mix(in_oklch,var(--danger)_8%,transparent)] px-3 py-2 text-xs text-danger">{err}</div>}
      {adding && <AddVm onDone={(ok) => { setAdding(false); if (ok) refresh(); }} onError={setErr} />}

      <div className="border-t border-line">
        {vms.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-faint">no VMs yet — add one with its SSH host and credentials</div>
        ) : (
          vms.map((vm) => {
            const open = expanded === vm.id;
            const s = vm.stats;
            const reachable = s?.reachable;
            return (
              <div key={vm.id} className="border-b border-line/50 last:border-0">
                <button onClick={() => setExpanded(open ? null : vm.id)} className={cn('flex w-full flex-wrap items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-[var(--bg-2)]/40', open && 'bg-[var(--bg-2)]/50')}>
                  {open ? <ChevronDown size={15} className="text-accent" /> : <ChevronRight size={15} className="text-faint" />}
                  <StatusDot color={reachable ? 'var(--good)' : reachable === false ? 'var(--danger)' : 'var(--faint)'} pulse={false} />
                  <Server size={15} className="text-muted" />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-text">{vm.name}</span>
                    <span className="block font-mono text-[0.66rem] text-faint">{vm.username}@{vm.host}:{vm.port}{s?.os ? ` · ${s.os}` : ''}</span>
                  </span>
                  <div className="ml-auto flex flex-wrap items-center gap-4">
                    <Mini label="CPU" v={s?.cpuPct} />
                    <MiniBar label="MEM" r={ratio(s?.memUsedKb, s?.memTotalKb)} />
                    <span className="hidden w-20 text-right text-xs text-muted sm:inline">{s?.uptimeSec != null ? uptime(s.uptimeSec) : '—'}</span>
                    <span onClick={(e) => { e.stopPropagation(); onOpenTerminal(vm.id); }} className="flex items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-xs text-muted hover:text-accent" title="open terminal">
                      <TerminalSquare size={13} /> Terminal
                    </span>
                  </div>
                </button>
                {open && <VmDetail vm={vm} busy={busy === vm.id} onTerminal={() => onOpenTerminal(vm.id)} onRefresh={() => act(vm.id, () => vmSend('POST', `/api/vms/${vm.id}/refresh`))} onDelete={() => act(vm.id, () => vmSend('DELETE', `/api/vms/${vm.id}`))} onSave={(patch) => act(vm.id, () => vmSend('PATCH', `/api/vms/${vm.id}`, patch))} />}
              </div>
            );
          })
        )}
      </div>
    </Panel>
  );
}

function Mini({ label, v }: { label: string; v?: number }) {
  return (
    <span className="hidden items-center gap-1.5 md:flex">
      <span className="label">{label}</span>
      <span className="stat w-9 text-right text-xs text-text">{v != null ? `${v}%` : '—'}</span>
    </span>
  );
}
function MiniBar({ label, r }: { label: string; r: number }) {
  return (
    <span className="hidden items-center gap-1.5 lg:flex">
      <span className="label">{label}</span>
      <UsageBar ratio={r} className="w-16" color="var(--violet)" />
    </span>
  );
}

function VmDetail({ vm, busy, onTerminal, onRefresh, onDelete, onSave }: { vm: VmMachine; busy: boolean; onTerminal: () => void; onRefresh: () => void; onDelete: () => void; onSave: (patch: Record<string, unknown>) => void }) {
  const s = vm.stats;
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState({ name: vm.name, host: vm.host, port: String(vm.port), username: vm.username, password: '', tags: (vm.tags ?? []).join(', '), notes: vm.notes ?? '' });

  return (
    <div className="border-t border-line bg-[var(--bg-1)]/60 px-5 py-4">
      {/* action bar */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button onClick={onTerminal} className="flex items-center gap-1.5 rounded-lg border border-accent/40 bg-[color-mix(in_oklch,var(--accent)_14%,transparent)] px-3 py-2 text-sm font-medium text-accent"><TerminalSquare size={14} /> Open terminal</button>
        <button onClick={onRefresh} disabled={busy} className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-sm text-muted hover:text-text disabled:opacity-50"><RotateCw size={14} className={busy ? 'animate-spin' : ''} /> Refresh telemetry</button>
        <button onClick={() => setEditing((e) => !e)} className="rounded-lg border border-line px-3 py-2 text-sm text-muted hover:text-text">{editing ? 'Cancel edit' : 'Edit'}</button>
        <button onClick={onDelete} disabled={busy} className="ml-auto flex items-center gap-1.5 rounded-lg border border-danger/40 px-3 py-2 text-sm text-danger disabled:opacity-50"><Trash2 size={14} /> Remove</button>
      </div>

      {editing && (
        <div className="mb-4 grid grid-cols-1 gap-2 rounded-lg border border-line bg-[var(--bg-2)]/40 p-3 sm:grid-cols-3">
          <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="name" className={cls} />
          <input value={f.host} onChange={(e) => setF({ ...f, host: e.target.value })} placeholder="host" className={cls} />
          <input value={f.port} onChange={(e) => setF({ ...f, port: e.target.value })} placeholder="port" className={cls} />
          <input value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} placeholder="username" className={cls} />
          <input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} placeholder="new password (leave blank to keep)" className={cls} />
          <input value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} placeholder="tags (comma-separated)" className={cls} />
          <input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="notes" className={cls + ' sm:col-span-2'} />
          <button onClick={() => { onSave({ name: f.name, host: f.host, port: Number(f.port) || 22, username: f.username, ...(f.password ? { password: f.password } : {}), tags: f.tags.split(',').map((t) => t.trim()).filter(Boolean), notes: f.notes }); setEditing(false); }} className="flex items-center justify-center gap-1.5 rounded-lg border border-accent/40 bg-[color-mix(in_oklch,var(--accent)_14%,transparent)] px-4 py-2 text-sm font-medium text-accent"><Save size={14} /> Save</button>
        </div>
      )}

      {s?.error && <div className="mb-4 rounded-lg border border-danger/30 bg-[color-mix(in_oklch,var(--danger)_8%,transparent)] px-3 py-2 text-xs text-danger">unreachable: {s.error}</div>}

      {/* system facts */}
      <Section title="System">
        <Grid>
          <Field label="Hostname" value={s?.hostname} mono />
          <Field label="Operating system" value={s?.os} />
          <Field label="Kernel" value={s?.kernel} mono />
          <Field label="Architecture" value={s?.arch} mono />
          <Field label="Virtualization" value={s?.virtType} />
          <Field label="Uptime" value={s?.uptimeSec != null ? uptime(s.uptimeSec) : undefined} />
          <Field label="CPU model" value={s?.cpuModel} cls="sm:col-span-2 lg:col-span-3" />
          <Field label="CPU cores" value={s?.cpuCores != null ? String(s.cpuCores) : undefined} />
          <Field label="Load (1·5·15m)" value={s?.load1 != null ? `${s.load1} · ${s.load5} · ${s.load15}` : undefined} mono />
          <Field label="Logged-in users" value={s?.loggedInUsers != null ? String(s.loggedInUsers) : undefined} />
          <Field label="Processes" value={s?.processes != null ? String(s.processes) : undefined} />
          <Field label="IP addresses" value={s?.ipAddrs?.join(', ')} mono cls="sm:col-span-2 lg:col-span-2" />
        </Grid>
      </Section>

      {/* resource usage */}
      <Section title="Resources">
        <div className="grid gap-4 sm:grid-cols-2">
          <Gauge label="CPU" pct={s?.cpuPct} sub={s?.cpuCores ? `${s.cpuCores} cores · load ${s?.load1 ?? '—'}` : undefined} />
          <Gauge label="Memory" pct={s?.memTotalKb ? Math.round(ratio(s.memUsedKb, s.memTotalKb) * 100) : undefined} sub={s?.memTotalKb ? `${fmtKb(s.memUsedKb)} / ${fmtKb(s.memTotalKb)}${s.memAvailableKb != null ? ` · ${fmtKb(s.memAvailableKb)} free` : ''}` : undefined} color="var(--violet)" />
          {s?.swapTotalKb ? <Gauge label="Swap" pct={Math.round(ratio(s.swapUsedKb, s.swapTotalKb) * 100)} sub={`${fmtKb(s.swapUsedKb)} / ${fmtKb(s.swapTotalKb)}`} color="var(--warn)" /> : null}
        </div>
      </Section>

      {/* disks */}
      {s?.disks?.length ? (
        <Section title="Disks">
          <div className="flex flex-col gap-2">
            {s.disks.map((d) => (
              <div key={d.mount} className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-[var(--bg-2)]/40 px-3 py-2 text-xs">
                <span className="font-mono text-text">{d.mount}</span>
                {d.fs && <span className="text-faint">{d.fs}</span>}
                <span className="ml-auto text-muted">{fmtKb(d.usedKb)} / {fmtKb(d.sizeKb)}</span>
                <UsageBar ratio={d.usePct / 100} className="w-28" />
                <span className="stat w-9 text-right text-text">{d.usePct}%</span>
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      {/* registration meta */}
      <Section title="Registration">
        <Grid>
          <Field label="SSH endpoint" value={`${vm.host}:${vm.port}`} mono />
          <Field label="Login user" value={vm.username} mono />
          <Field label="Credentials" value={vm.hasPassword ? 'password saved' : 'none'} />
          <Field label="Tags" node={vm.tags?.length ? <span className="flex flex-wrap gap-1">{vm.tags.map((t) => <Badge key={t} color="var(--accent-dim)">{t}</Badge>)}</span> : undefined} />
          <Field label="Added" value={relTime(vm.createdAt)} />
          <Field label="Last checked" value={vm.lastChecked ? `${relTime(vm.lastChecked)}${s?.collectedMs != null ? ` · ${s.collectedMs}ms` : ''}` : 'never'} />
          {vm.notes ? <Field label="Notes" value={vm.notes} cls="sm:col-span-2 lg:col-span-3" /> : null}
        </Grid>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4 last:mb-0">
      <div className="label mb-2 border-b border-line/60 pb-1">{title}</div>
      {children}
    </div>
  );
}
function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-x-6 gap-y-2.5 sm:grid-cols-2 lg:grid-cols-3">{children}</div>;
}
function Field({ label, value, node, mono, cls: extra }: { label: string; value?: string; node?: React.ReactNode; mono?: boolean; cls?: string }) {
  return (
    <div className={extra}>
      <div className="label">{label}</div>
      {node ?? <div className={cn('truncate text-sm text-text', mono && 'font-mono text-xs')} title={value}>{value || '—'}</div>}
    </div>
  );
}
function Gauge({ label, pct, sub, color }: { label: string; pct?: number; sub?: string; color?: string }) {
  return (
    <div className="rounded-lg border border-line bg-[var(--bg-2)]/40 p-3">
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="label">{label}</span>
        <span className="stat text-lg font-semibold text-text">{pct != null ? `${pct}%` : '—'}</span>
      </div>
      <UsageBar ratio={(pct ?? 0) / 100} color={color} height={8} />
      {sub && <div className="mt-1.5 truncate text-xs text-muted">{sub}</div>}
    </div>
  );
}

function AddVm({ onDone, onError }: { onDone: (ok: boolean) => void; onError: (e: string) => void }) {
  const [f, setF] = useState({ name: '', host: '', port: '22', username: '', password: '', tags: '', notes: '' });
  const [busy, setBusy] = useState(false);
  async function create() {
    if (!f.name || !f.host || !f.username) {
      onError('name, host and username are required');
      return;
    }
    setBusy(true);
    try {
      await vmSend('POST', '/api/vms', { name: f.name, host: f.host, port: Number(f.port) || 22, username: f.username, password: f.password, tags: f.tags.split(',').map((t) => t.trim()).filter(Boolean), notes: f.notes });
      onDone(true);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'add failed');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="grid grid-cols-1 gap-2 border-y border-line bg-[var(--bg-2)]/40 px-5 py-4 sm:grid-cols-3">
      <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="display name" className={cls} />
      <input value={f.host} onChange={(e) => setF({ ...f, host: e.target.value })} placeholder="host / IP" className={cls} />
      <input value={f.port} onChange={(e) => setF({ ...f, port: e.target.value })} placeholder="SSH port (22)" className={cls} />
      <input value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} placeholder="SSH username" className={cls} />
      <input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} placeholder="SSH password" className={cls} />
      <input value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} placeholder="tags (comma-separated)" className={cls} />
      <input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="notes (optional)" className={cls + ' sm:col-span-2'} />
      <button onClick={create} disabled={busy} className="rounded-lg border border-accent/40 bg-[color-mix(in_oklch,var(--accent)_14%,transparent)] px-4 py-2 text-sm font-medium text-accent disabled:opacity-50">{busy ? 'connecting…' : 'Add & probe'}</button>
    </div>
  );
}
