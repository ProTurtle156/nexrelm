'use client';

import { useEffect, useState } from 'react';
import { Plus, Trash2, Check } from 'lucide-react';
import type { DhcpOptionDef, DhcpOptionValue, DhcpScopeDef } from '@nexrelm/types';
import { dhcpSend, useDhcp } from '@/lib/dhcp';
import { Panel, PanelHeader } from '@/components/ui/Panel';

const cls = 'rounded-lg border border-line bg-[var(--bg-2)] px-3 py-1.5 font-mono text-sm text-text outline-none placeholder:text-faint focus:border-accent/50';

function OptionEditor({ value, catalog, onSave }: { value: DhcpOptionValue[]; catalog: DhcpOptionDef[]; onSave: (o: DhcpOptionValue[]) => Promise<void> }) {
  const [draft, setDraft] = useState<DhcpOptionValue[]>(value);
  const [pick, setPick] = useState<number>(catalog[0]?.code ?? 3);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => setDraft(value), [value]);

  const def = (code: number) => catalog.find((c) => c.code === code);
  const add = () => {
    if (draft.some((o) => o.code === pick)) return;
    setDraft([...draft, { code: pick, value: '' }]);
    setSaved(false);
  };
  const set = (code: number, v: string) => { setDraft(draft.map((o) => (o.code === code ? { ...o, value: v } : o))); setSaved(false); };
  const del = (code: number) => { setDraft(draft.filter((o) => o.code !== code)); setSaved(false); };

  async function save() {
    setBusy(true);
    try { await onSave(draft.filter((o) => o.value.trim() !== '')); setSaved(true); } finally { setBusy(false); }
  }

  return (
    <div className="flex flex-col gap-2 px-5 pb-5 pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <select value={pick} onChange={(e) => setPick(Number(e.target.value))} className={cls + ' flex-1'}>
          {catalog.map((c) => (
            <option key={c.code} value={c.code}>{String(c.code).padStart(3, '0')} — {c.name}</option>
          ))}
        </select>
        <button onClick={add} className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm text-muted hover:text-text"><Plus size={14} /> Add option</button>
      </div>
      {draft.length === 0 && <p className="py-2 text-xs text-faint">no options set — inherits defaults</p>}
      {draft.map((o) => (
        <div key={o.code} className="flex items-center gap-2">
          <span className="w-44 shrink-0 text-xs text-muted">{String(o.code).padStart(3, '0')} {def(o.code)?.name ?? 'Custom'}</span>
          <input value={o.value} onChange={(e) => set(o.code, e.target.value)} placeholder={def(o.code)?.kind === 'ips' ? 'ip,ip' : def(o.code)?.hint ?? 'value'} className={cls + ' flex-1'} />
          <button onClick={() => del(o.code)} className="text-faint hover:text-danger"><Trash2 size={14} /></button>
        </div>
      ))}
      <div className="mt-1 flex justify-end">
        <button onClick={save} disabled={busy} className="flex items-center gap-1.5 rounded-lg border border-accent/40 bg-[color-mix(in_oklch,var(--accent)_14%,transparent)] px-4 py-1.5 text-sm font-medium text-accent disabled:opacity-50">
          {saved && <Check size={14} />} {busy ? 'saving…' : saved ? 'Saved' : 'Save options'}
        </button>
      </div>
    </div>
  );
}

export function Options({ scopes, scopeId, refreshScopes }: { scopes: DhcpScopeDef[]; scopeId: string | null; refreshScopes: () => void }) {
  const { data: catalog } = useDhcp<DhcpOptionDef[]>('/api/dhcp/option-catalog', 0);
  const { data: serverOpts, refresh } = useDhcp<DhcpOptionValue[]>('/api/dhcp/server-options', 0);
  const scope = scopes.find((s) => s.id === scopeId);

  return (
    <div className="flex flex-col gap-5">
      <Panel brackets>
        <PanelHeader label="Server Options" title="Apply to every scope" hint="defaults handed to all clients unless a scope overrides them" />
        <OptionEditor value={serverOpts ?? []} catalog={catalog ?? []} onSave={async (o) => { await dhcpSend('PUT', '/api/dhcp/server-options', { options: o }); refresh(); }} />
      </Panel>

      {scope ? (
        <Panel>
          <PanelHeader label="Scope Options" title={scope.name} hint="override the server options for this scope" />
          <OptionEditor value={scope.options} catalog={catalog ?? []} onSave={async (o) => { await dhcpSend('PATCH', `/api/dhcp/scopes/${scope.id}`, { options: o }); refreshScopes(); }} />
        </Panel>
      ) : (
        <Panel><div className="px-5 py-6 text-sm text-faint">Select a scope (Scopes tab) to edit its options.</div></Panel>
      )}
    </div>
  );
}
