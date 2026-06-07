'use client';

import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { DhcpPolicy, DhcpPolicyCondition } from '@nexrelm/types';
import { dhcpSend, useDhcp } from '@/lib/dhcp';
import { Panel, PanelHeader } from '@/components/ui/Panel';
import { Badge } from '@/components/ui/Badge';
import { StatusDot } from '@/components/ui/StatusDot';

const cls = 'rounded-lg border border-line bg-[var(--bg-2)] px-3 py-2 font-mono text-sm text-text outline-none placeholder:text-faint focus:border-accent/50';

export function Policies({ scopeId }: { scopeId: string | null }) {
  const path = scopeId ? `/api/dhcp/policies?scopeId=${scopeId}` : '/api/dhcp/policies';
  const { data, refresh } = useDhcp<DhcpPolicy[]>(path, 0, [path]);
  const [name, setName] = useState('');
  const [conditionType, setType] = useState<DhcpPolicyCondition>('mac');
  const [conditionValue, setValue] = useState('');

  async function add() {
    if (!scopeId || !name || !conditionValue) return;
    await dhcpSend('POST', '/api/dhcp/policies', { scopeId, name, conditionType, conditionValue });
    setName(''); setValue(''); refresh();
  }
  async function toggle(p: DhcpPolicy) { await dhcpSend('PATCH', `/api/dhcp/policies/${p.id}`, { enabled: !p.enabled }); refresh(); }
  async function remove(p: DhcpPolicy) { await dhcpSend('DELETE', `/api/dhcp/policies/${p.id}`); refresh(); }

  return (
    <Panel>
      <PanelHeader label="Policies" title="Conditional assignment" hint={scopeId ? 'match clients by MAC / vendor / user class → apply extra options' : 'select a scope first'} />
      {scopeId && (
        <div className="flex flex-wrap items-center gap-2 px-5 py-3">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="policy name" className={cls + ' flex-1'} />
          <select value={conditionType} onChange={(e) => setType(e.target.value as DhcpPolicyCondition)} className={cls}>
            <option value="mac">MAC prefix</option>
            <option value="vendor">Vendor class</option>
            <option value="user">User class</option>
          </select>
          <input value={conditionValue} onChange={(e) => setValue(e.target.value)} placeholder={conditionType === 'mac' ? '8c:84:42' : 'match value'} className={cls + ' w-44'} />
          <button onClick={add} className="flex items-center gap-1.5 rounded-lg border border-accent/40 bg-[color-mix(in_oklch,var(--accent)_14%,transparent)] px-4 py-2 text-sm font-medium text-accent">
            <Plus size={15} /> Add
          </button>
        </div>
      )}
      <div className="border-t border-line">
        {(data ?? []).length === 0 && <div className="px-5 py-6 text-center text-sm text-faint">no policies</div>}
        {(data ?? []).map((p) => (
          <div key={p.id} className="flex flex-wrap items-center gap-3 border-b border-line/50 px-5 py-3 last:border-0">
            <button onClick={() => toggle(p)}><StatusDot color={p.enabled ? 'var(--good)' : 'var(--faint)'} pulse={false} /></button>
            <span className="text-sm font-medium text-text">{p.name}</span>
            <Badge color="var(--accent-dim)">{p.conditionType}</Badge>
            <span className="font-mono text-xs text-muted">{p.conditionValue}</span>
            <button onClick={() => remove(p)} className="ml-auto text-faint hover:text-danger" title="delete"><Trash2 size={14} /></button>
          </div>
        ))}
      </div>
    </Panel>
  );
}
