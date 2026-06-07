'use client';

import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { AdGroup, AdGroupScope, AdGroupType } from '@nexrelm/types';
import { dirSend, useDir } from '@/lib/directory';
import { Panel, PanelHeader } from '@/components/ui/Panel';
import { Badge } from '@/components/ui/Badge';
import { DataTable, type Column } from '@/components/ui/DataTable';

const cls = 'rounded-lg border border-line bg-[var(--bg-2)] px-3 py-2 text-sm text-text outline-none placeholder:text-faint focus:border-accent/50';

export function Groups() {
  const { data, refresh } = useDir<AdGroup[]>('/api/directory/groups', 0);
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ name: '', description: '', scope: 'global' as AdGroupScope, type: 'security' as AdGroupType });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function create() {
    if (!f.name) return;
    setBusy(true);
    setErr(null);
    try {
      await dirSend('POST', '/api/directory/groups', f);
      setF({ name: '', description: '', scope: 'global', type: 'security' });
      setAdding(false);
      refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'create failed');
    } finally {
      setBusy(false);
    }
  }
  async function remove(g: AdGroup) {
    try {
      await dirSend('DELETE', `/api/directory/groups?dn=${encodeURIComponent(g.dn)}`);
      refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'delete failed');
    }
  }

  const cols: Array<Column<AdGroup>> = [
    { key: 'name', header: 'Group', cell: (g) => <span className="text-sm font-medium text-text">{g.name}</span> },
    { key: 'desc', header: 'Description', cell: (g) => <span className="text-xs text-muted">{g.description ?? '—'}</span> },
    { key: 'scope', header: 'Scope', cell: (g) => <Badge color="var(--accent-dim)">{g.scope}</Badge> },
    { key: 'type', header: 'Type', cell: (g) => <Badge color={g.type === 'security' ? 'var(--violet)' : 'var(--faint)'}>{g.type}</Badge> },
    { key: 'members', header: 'Members', align: 'right', cell: (g) => <span className="stat text-xs text-muted">{g.memberCount}</span> },
    { key: 'act', header: '', align: 'right', cell: (g) => <button onClick={() => remove(g)} className="text-faint hover:text-danger" title="delete"><Trash2 size={14} /></button> },
  ];

  return (
    <Panel>
      <PanelHeader
        label="Groups"
        title="Security & distribution groups"
        hint={`${data?.length ?? 0} groups`}
        right={<button onClick={() => setAdding((a) => !a)} className="flex items-center gap-1.5 rounded-lg border border-accent/40 bg-[color-mix(in_oklch,var(--accent)_14%,transparent)] px-3 py-1.5 text-xs font-medium text-accent"><Plus size={14} /> New group</button>}
      />
      {err && <div className="mx-5 mb-1 rounded-lg border border-danger/30 bg-[color-mix(in_oklch,var(--danger)_8%,transparent)] px-3 py-2 text-xs text-danger">{err}</div>}
      {adding && (
        <div className="grid grid-cols-1 gap-2 border-y border-line bg-[var(--bg-2)]/40 px-5 py-4 sm:grid-cols-4">
          <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="group name" className={cls} />
          <input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="description" className={cls} />
          <select value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value as AdGroupScope })} className={cls}>
            <option value="global">Global</option>
            <option value="domainLocal">Domain local</option>
            <option value="universal">Universal</option>
          </select>
          <select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as AdGroupType })} className={cls}>
            <option value="security">Security</option>
            <option value="distribution">Distribution</option>
          </select>
          <button onClick={create} disabled={busy} className="rounded-lg border border-accent/40 bg-[color-mix(in_oklch,var(--accent)_14%,transparent)] px-4 py-2 text-sm font-medium text-accent disabled:opacity-50 sm:col-span-4">{busy ? 'creating…' : 'Create group'}</button>
        </div>
      )}
      <div className="pb-2 pt-1">
        <DataTable columns={cols} rows={data ?? []} rowKey={(g) => g.dn} empty="no groups" />
      </div>
    </Panel>
  );
}
