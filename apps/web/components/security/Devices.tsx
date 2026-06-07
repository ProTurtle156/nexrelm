'use client';

import { useState } from 'react';
import { MonitorSmartphone, ShieldCheck, Ban, Clock, Check, Activity, ListChecks } from 'lucide-react';
import type { DeviceRegistryState, RegisteredDevice, DeviceTrust, BaselineState } from '@nexrelm/types';
import { useSec, secSend } from '@/lib/security';
import { relTime } from '@/lib/format';
import { Panel, PanelHeader } from '@/components/ui/Panel';
import { Loading } from '@/components/ui/Loading';

const TRUST_META: Record<DeviceTrust, { color: string; label: string }> = {
  pending: { color: 'var(--warn)', label: 'new · pending' },
  known: { color: 'var(--good)', label: 'known' },
  blocked: { color: 'var(--danger)', label: 'blocked' },
};

export function Devices() {
  const { data, loading, refresh } = useSec<DeviceRegistryState>('/api/security/registry', 5000);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  if (loading && !data) return <Loading label="loading device registry" />;
  if (!data) return null;

  const ordered = [...data.devices].sort((a, b) => {
    const rank: Record<DeviceTrust, number> = { pending: 0, blocked: 1, known: 2 };
    return rank[a.trust] - rank[b.trust] || b.lastSeen.localeCompare(a.lastSeen);
  });
  const allSelected = ordered.length > 0 && ordered.every((d) => selected.has(d.mac));
  const hasSelection = selected.size > 0;

  function toggle(mac: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(mac) ? next.delete(mac) : next.add(mac);
      return next;
    });
  }
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(ordered.map((d) => d.mac)));
  }
  async function bulk(action: 'approve' | 'block', macs?: string[]) {
    const count = macs ? macs.length : ordered.length;
    if (count === 0) return;
    if (action === 'block' && !confirm(`Block ${macs ? `the ${count} selected` : `all ${count}`} device(s)?`)) return;
    await secSend('POST', '/api/security/registry/bulk', { action, macs });
    setSelected(new Set());
    refresh();
  }

  return (
    <div className="flex flex-col gap-5">
      <Panel brackets>
        <PanelHeader
          label="Devices"
          title="Network device registry"
          hint={`${data.known} known · ${data.pending} new · ${data.blocked} blocked`}
          right={<MonitorSmartphone size={16} className="text-accent" />}
        />
        {data.pending > 0 && (
          <p className="mx-5 mb-3 rounded-lg border border-warn/40 bg-[color-mix(in_oklch,var(--warn)_8%,transparent)] px-3 py-2 text-xs text-warn">
            {data.pending} new device{data.pending === 1 ? '' : 's'} seen for the first time — approve the ones you recognise, block the ones you don't.
          </p>
        )}
        {ordered.length > 0 && (
          <div className="mx-5 mb-2 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-[var(--bg-1)] px-3 py-2">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-muted">
              <input type="checkbox" checked={allSelected} onChange={toggleAll} className="accent-[var(--accent)]" />
              <ListChecks size={15} className="text-accent" />
              Select all
              <span className="stat text-xs text-faint">{hasSelection ? `${selected.size} selected` : `${ordered.length} devices`}</span>
            </label>
            <div className="flex items-center gap-2">
              <button onClick={() => bulk('approve', hasSelection ? [...selected] : undefined)} className="flex items-center gap-1.5 rounded-lg border border-good/40 px-3 py-1.5 text-xs font-medium text-good hover:bg-[color-mix(in_oklch,var(--good)_12%,transparent)]"><ShieldCheck size={13} /> {hasSelection ? 'Approve selected' : 'Approve all'}</button>
              <button onClick={() => bulk('block', hasSelection ? [...selected] : undefined)} className="flex items-center gap-1.5 rounded-lg border border-danger/40 px-3 py-1.5 text-xs font-medium text-danger hover:bg-[color-mix(in_oklch,var(--danger)_12%,transparent)]"><Ban size={13} /> {hasSelection ? 'Block selected' : 'Block all'}</button>
            </div>
          </div>
        )}
        <div className="flex flex-col">
          {ordered.length === 0 && <p className="px-5 py-10 text-center text-sm text-faint">No devices tracked yet. Devices are registered by MAC as the inventory observes them (run Discover network in the Vulnerabilities tab, or start the sniffer).</p>}
          {ordered.map((d) => (
            <DeviceRow key={d.mac} d={d} onChange={refresh} selected={selected.has(d.mac)} onToggle={() => toggle(d.mac)} />
          ))}
        </div>
      </Panel>

      <Baseline />
    </div>
  );
}

function DeviceRow({ d, onChange, selected, onToggle }: { d: RegisteredDevice; onChange: () => void; selected: boolean; onToggle: () => void }) {
  const [name, setName] = useState(d.name ?? '');
  const [editing, setEditing] = useState(false);
  const meta = TRUST_META[d.trust];

  async function act(action: 'approve' | 'block' | 'pending') {
    await secSend('POST', `/api/security/registry/${encodeURIComponent(d.mac)}`, { action });
    onChange();
  }
  async function saveName() {
    setEditing(false);
    if (name !== (d.name ?? '')) {
      await secSend('POST', `/api/security/registry/${encodeURIComponent(d.mac)}`, { name });
      onChange();
    }
  }

  return (
    <div className={`flex items-center gap-3 border-b border-line/50 px-5 py-3 last:border-0 ${selected ? 'bg-[color-mix(in_oklch,var(--accent)_7%,transparent)]' : ''}`}>
      <input type="checkbox" checked={selected} onChange={onToggle} className="shrink-0 accent-[var(--accent)]" />
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: meta.color, boxShadow: `0 0 6px ${meta.color}` }} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {editing ? (
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onBlur={saveName} onKeyDown={(e) => e.key === 'Enter' && saveName()} placeholder="name this device" className="w-40 rounded border border-line bg-[var(--bg-0)] px-2 py-0.5 text-sm text-text outline-none focus:border-accent" />
          ) : (
            <button onClick={() => setEditing(true)} className="text-sm font-medium text-text hover:text-accent">{d.name || d.ip || d.mac}</button>
          )}
          <span className="rounded-full px-2 py-0.5 text-[0.6rem] uppercase tracking-wide" style={{ color: meta.color, background: `color-mix(in oklch, ${meta.color} 12%, transparent)` }}>{meta.label}</span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 stat text-[0.66rem] text-faint">
          <span className="text-muted">{d.ip}</span>
          <span>{d.mac}</span>
          {d.vendor && <span>{d.vendor}</span>}
          {d.os && <span>{d.os}</span>}
          <span>first seen {relTime(d.firstSeen)}</span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {d.trust !== 'known' && <button onClick={() => act('approve')} title="Approve as known" className="flex items-center gap-1 rounded-lg border border-good/40 px-2 py-1 text-[0.66rem] text-good hover:bg-[color-mix(in_oklch,var(--good)_12%,transparent)]"><ShieldCheck size={12} /> Approve</button>}
        {d.trust !== 'blocked' && <button onClick={() => act('block')} title="Block this device" className="flex items-center gap-1 rounded-lg border border-danger/40 px-2 py-1 text-[0.66rem] text-danger hover:bg-[color-mix(in_oklch,var(--danger)_12%,transparent)]"><Ban size={12} /> Block</button>}
        {d.trust !== 'pending' && <button onClick={() => act('pending')} title="Reset to pending" className="rounded-lg border border-line px-2 py-1 text-faint hover:text-text"><Clock size={12} /></button>}
      </div>
    </div>
  );
}

function Baseline() {
  const { data } = useSec<BaselineState>('/api/security/baseline', 8000);
  if (!data) return null;
  const anomalous = data.devices.filter((d) => d.anomalous);
  const shown = [...data.devices].sort((a, b) => Number(b.anomalous) - Number(a.anomalous)).slice(0, 12);
  return (
    <Panel>
      <PanelHeader label="Behaviour" title="Adaptive baseline" hint={data.learning ? `learning · ${anomalous.length} anomalous` : 'paused'} right={<Activity size={16} className="text-violet" />} />
      <div className="px-5 pb-5 pt-2">
        <p className="mb-3 text-[0.66rem] text-faint">Each device's normal DNS behaviour is learned online (mean ± σ). A metric jumping past 3σ above its own baseline raises a <span className="text-violet">behavioural anomaly</span>. Needs ~15 samples per device before it fires.</p>
        {shown.length === 0 && <p className="py-6 text-center text-sm text-faint">no baseline data yet — it accumulates as devices generate DNS traffic</p>}
        <div className="flex flex-col gap-2">
          {shown.map((d) => (
            <div key={d.client} className={`rounded-lg border px-3 py-2 ${d.anomalous ? 'border-violet/50 bg-[color-mix(in_oklch,var(--violet)_8%,transparent)]' : 'border-line/60'}`}>
              <div className="flex items-center justify-between">
                <span className="stat text-xs text-text">{d.client}</span>
                {d.anomalous && <span className="flex items-center gap-1 text-[0.6rem] text-violet"><Check size={11} /> anomalous</span>}
              </div>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
                {d.metrics.map((m) => (
                  <span key={m.metric} className="text-[0.64rem]" title={`mean ${m.mean.toFixed(1)} · ${m.samples} samples`}>
                    <span className="text-faint">{m.metric.replace(/_/g, ' ')}</span>{' '}
                    <span className="stat" style={{ color: m.deviation >= 3 && m.samples >= 15 ? 'var(--violet)' : 'var(--muted)' }}>{m.current.toFixed(1)}</span>
                    {m.samples >= 15 && m.std > 0 && <span className="text-faint"> ({m.deviation >= 0 ? '+' : ''}{m.deviation.toFixed(1)}σ)</span>}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}
