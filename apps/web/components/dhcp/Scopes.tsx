'use client';

import { useState } from 'react';
import { Plus, Trash2, Pencil } from 'lucide-react';
import type { DhcpDnsMode, DhcpExclusion, DhcpScopeDef } from '@nexrelm/types';
import { dhcpSend, useDhcp } from '@/lib/dhcp';
import { cn } from '@/lib/format';
import { Panel, PanelHeader } from '@/components/ui/Panel';
import { Badge } from '@/components/ui/Badge';

export interface ScopeTabProps {
  scopes: DhcpScopeDef[];
  scopeId: string | null;
  setScopeId: (id: string) => void;
  refreshScopes: () => void;
}

const blank = { name: '', mask: '255.255.255.0', rangeStart: '', rangeEnd: '', leaseHours: 24, description: '', dnsMode: 'inherit' as DhcpDnsMode, dnsServers: '' };

export function Scopes({ scopes, scopeId, setScopeId, refreshScopes }: ScopeTabProps) {
  const [form, setForm] = useState(blank);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!form.name || !form.rangeStart || !form.rangeEnd) return;
    setBusy(true);
    try {
      const body = {
        name: form.name, mask: form.mask, rangeStart: form.rangeStart, rangeEnd: form.rangeEnd,
        leaseSeconds: form.leaseHours * 3600, description: form.description,
        dnsMode: form.dnsMode, dnsServers: form.dnsServers.split(',').map((x) => x.trim()).filter(Boolean),
      };
      if (editing) await dhcpSend('PATCH', `/api/dhcp/scopes/${editing}`, body);
      else await dhcpSend('POST', '/api/dhcp/scopes', body);
      setForm(blank);
      setEditing(null);
      refreshScopes();
    } finally {
      setBusy(false);
    }
  }
  function edit(s: DhcpScopeDef) {
    setEditing(s.id);
    setForm({ name: s.name, mask: s.mask, rangeStart: s.rangeStart, rangeEnd: s.rangeEnd, leaseHours: Math.round(s.leaseSeconds / 3600), description: s.description ?? '', dnsMode: s.dnsMode, dnsServers: s.dnsServers.join(', ') });
  }
  async function toggleState(s: DhcpScopeDef) {
    await dhcpSend('PATCH', `/api/dhcp/scopes/${s.id}`, { state: s.state === 'active' ? 'disabled' : 'active' });
    refreshScopes();
  }
  async function remove(s: DhcpScopeDef) {
    await dhcpSend('DELETE', `/api/dhcp/scopes/${s.id}`);
    refreshScopes();
  }

  return (
    <div className="flex flex-col gap-5">
      <Panel>
        <PanelHeader label={editing ? 'Edit scope' : 'New scope'} title="Address scope" hint="a range of addresses to lease, plus its mask and lease time" />
        <div className="grid grid-cols-1 gap-2 px-5 py-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Name"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="LAN" className={inputCls} /></Field>
          <Field label="Subnet mask"><input value={form.mask} onChange={(e) => setForm({ ...form, mask: e.target.value })} placeholder="255.255.255.0" className={inputCls} /></Field>
          <Field label="Lease (hours)"><input type="number" value={form.leaseHours} onChange={(e) => setForm({ ...form, leaseHours: Number(e.target.value) })} className={inputCls} /></Field>
          <Field label="Range start"><input value={form.rangeStart} onChange={(e) => setForm({ ...form, rangeStart: e.target.value })} placeholder="192.168.1.100" className={inputCls} /></Field>
          <Field label="Range end"><input value={form.rangeEnd} onChange={(e) => setForm({ ...form, rangeEnd: e.target.value })} placeholder="192.168.1.200" className={inputCls} /></Field>
          <Field label="Description"><input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="optional" className={inputCls} /></Field>
        </div>
        <div className="flex flex-wrap items-center gap-3 px-5 pb-3">
          <span className="label w-16">DNS</span>
          <div className="flex gap-1">
            {(['inherit', 'nexrelm', 'custom'] as const).map((m) => {
              const lbl = m === 'inherit' ? 'Server default' : m === 'nexrelm' ? 'Nexrelm DNS' : 'Custom';
              const on = form.dnsMode === m;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => setForm({ ...form, dnsMode: m })}
                  className="rounded-full border px-3 py-1.5 text-xs transition-colors"
                  style={{ color: on ? 'var(--accent)' : 'var(--muted)', borderColor: on ? 'color-mix(in oklch, var(--accent) 40%, transparent)' : 'var(--line)', background: on ? 'color-mix(in oklch, var(--accent) 12%, transparent)' : 'transparent' }}
                >
                  {lbl}
                </button>
              );
            })}
          </div>
          {form.dnsMode === 'custom' ? (
            <input value={form.dnsServers} onChange={(e) => setForm({ ...form, dnsServers: e.target.value })} placeholder="1.1.1.1, 1.0.0.1" className={inputCls + ' w-60'} />
          ) : (
            <span className="text-xs text-faint">{form.dnsMode === 'nexrelm' ? 'this scope hands out Nexrelm’s resolver (option 006)' : 'use the server-wide DNS setting'}</span>
          )}
        </div>
        <div className="flex justify-end gap-2 px-5 pb-4">
          {editing && <button onClick={() => { setEditing(null); setForm(blank); }} className="rounded-lg border border-line px-4 py-2 text-sm text-muted hover:text-text">Cancel</button>}
          <button onClick={submit} disabled={busy} className="flex items-center gap-1.5 rounded-lg border border-accent/40 bg-[color-mix(in_oklch,var(--accent)_14%,transparent)] px-4 py-2 text-sm font-medium text-accent disabled:opacity-50">
            <Plus size={15} /> {editing ? 'Save scope' : 'Add scope'}
          </button>
        </div>
      </Panel>

      <Panel>
        <PanelHeader label="Scopes" title="Configured scopes" hint={`${scopes.length} scope${scopes.length === 1 ? '' : 's'}`} />
        <div className="border-t border-line">
          {scopes.length === 0 && <div className="px-5 py-8 text-center text-sm text-faint">no scopes — add one above</div>}
          {scopes.map((s) => (
            <div key={s.id} className={cn('flex flex-wrap items-center gap-3 border-b border-line/50 px-5 py-3 last:border-0', scopeId === s.id && 'bg-[color-mix(in_oklch,var(--accent)_6%,transparent)]')}>
              <button onClick={() => setScopeId(s.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: s.state === 'active' ? 'var(--good)' : 'var(--faint)' }} />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-text">{s.name}</span>
                  <span className="block font-mono text-[0.68rem] text-faint">{s.rangeStart} – {s.rangeEnd} · {s.mask} · {Math.round(s.leaseSeconds / 3600)}h · dns: {s.dnsMode === 'custom' ? s.dnsServers.join(',') : s.dnsMode === 'nexrelm' ? 'Nexrelm' : 'default'}</span>
                </span>
              </button>
              <Badge color={s.state === 'active' ? 'var(--good)' : 'var(--faint)'}>{s.state}</Badge>
              <button onClick={() => toggleState(s)} className="text-xs text-muted hover:text-text">{s.state === 'active' ? 'disable' : 'enable'}</button>
              <button onClick={() => edit(s)} className="text-faint hover:text-accent" title="edit"><Pencil size={14} /></button>
              <button onClick={() => remove(s)} className="text-faint hover:text-danger" title="delete"><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
      </Panel>

      {scopeId && <Exclusions scopeId={scopeId} scopeName={scopes.find((s) => s.id === scopeId)?.name ?? ''} />}
    </div>
  );
}

function Exclusions({ scopeId, scopeName }: { scopeId: string; scopeName: string }) {
  const { data, refresh } = useDhcp<DhcpExclusion[]>(`/api/dhcp/exclusions?scopeId=${scopeId}`, 0, [scopeId]);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  async function add() {
    if (!start || !end) return;
    await dhcpSend('POST', '/api/dhcp/exclusions', { scopeId, start, end });
    setStart(''); setEnd(''); refresh();
  }
  async function remove(id: string) {
    await dhcpSend('DELETE', `/api/dhcp/exclusions/${id}`); refresh();
  }
  return (
    <Panel brackets>
      <PanelHeader label="Address Pool" title={`Exclusions · ${scopeName}`} hint="addresses inside the range that are never handed out" />
      <div className="flex flex-wrap items-end gap-2 px-5 py-3">
        <input value={start} onChange={(e) => setStart(e.target.value)} placeholder="exclude from" className={inputCls + ' w-40'} />
        <span className="pb-2 text-faint">–</span>
        <input value={end} onChange={(e) => setEnd(e.target.value)} placeholder="to" className={inputCls + ' w-40'} />
        <button onClick={add} className="flex items-center gap-1.5 rounded-lg border border-accent/40 bg-[color-mix(in_oklch,var(--accent)_14%,transparent)] px-4 py-2 text-sm font-medium text-accent">
          <Plus size={15} /> Exclude
        </button>
      </div>
      <div className="border-t border-line">
        {(data ?? []).length === 0 && <div className="px-5 py-5 text-center text-xs text-faint">no exclusions</div>}
        {(data ?? []).map((e) => (
          <div key={e.id} className="flex items-center gap-3 border-b border-line/50 px-5 py-2.5 last:border-0">
            <span className="font-mono text-sm text-text">{e.start} – {e.end}</span>
            <button onClick={() => remove(e.id)} className="ml-auto text-faint hover:text-danger" title="delete"><Trash2 size={14} /></button>
          </div>
        ))}
      </div>
    </Panel>
  );
}

const inputCls = 'w-full rounded-lg border border-line bg-[var(--bg-2)] px-3 py-2 font-mono text-sm text-text outline-none placeholder:text-faint focus:border-accent/50';
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="label">{label}</span>
      {children}
    </label>
  );
}
