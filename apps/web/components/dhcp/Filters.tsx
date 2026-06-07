'use client';

import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { DhcpFilter, DhcpFilterSettings, DhcpFilterType } from '@nexrelm/types';
import { dhcpSend, useDhcp } from '@/lib/dhcp';
import { Panel, PanelHeader } from '@/components/ui/Panel';
import { Badge } from '@/components/ui/Badge';

interface FilterData {
  settings: DhcpFilterSettings;
  filters: DhcpFilter[];
}
const cls = 'rounded-lg border border-line bg-[var(--bg-2)] px-3 py-2 font-mono text-sm text-text outline-none placeholder:text-faint focus:border-accent/50';

function Toggle({ on, onChange, label, hint }: { on: boolean; onChange: (v: boolean) => void; label: string; hint: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <button type="button" onClick={() => onChange(!on)} className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full border transition-colors ${on ? 'border-accent/50 bg-[color-mix(in_oklch,var(--accent)_35%,transparent)]' : 'border-line bg-[var(--bg-2)]'}`}>
        <span className={`absolute top-0.5 h-3.5 w-3.5 rounded-full bg-text transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} />
      </button>
      <span><span className="text-sm text-text">{label}</span><span className="block text-xs text-faint">{hint}</span></span>
    </label>
  );
}

export function Filters() {
  const { data, refresh } = useDhcp<FilterData>('/api/dhcp/filters', 0);
  const [mac, setMac] = useState('');
  const [type, setType] = useState<DhcpFilterType>('allow');

  async function add() {
    if (!mac) return;
    await dhcpSend('POST', '/api/dhcp/filters', { mac, type });
    setMac(''); refresh();
  }
  async function remove(f: DhcpFilter) { await dhcpSend('DELETE', `/api/dhcp/filters/${f.id}`); refresh(); }
  async function setSettings(patch: Partial<DhcpFilterSettings>) { await dhcpSend('PATCH', '/api/dhcp/filter-settings', patch); refresh(); }

  const allow = data?.filters.filter((f) => f.type === 'allow') ?? [];
  const deny = data?.filters.filter((f) => f.type === 'deny') ?? [];

  return (
    <div className="flex flex-col gap-5">
      <Panel>
        <PanelHeader label="MAC Filters" title="Link-layer access control" hint="restrict which devices the server will lease to" />
        <div className="flex flex-col gap-3 px-5 py-4">
          <Toggle on={data?.settings.allowEnabled ?? false} onChange={(v) => setSettings({ allowEnabled: v })} label="Enable Allow list" hint="when on, ONLY MACs on the allow list are served" />
          <Toggle on={data?.settings.denyEnabled ?? false} onChange={(v) => setSettings({ denyEnabled: v })} label="Enable Deny list" hint="MACs on the deny list are always refused" />
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-3">
          <input value={mac} onChange={(e) => setMac(e.target.value)} placeholder="aa:bb:cc:dd:ee:ff  (or prefix 8c:84:42)" className={cls + ' flex-1'} />
          <select value={type} onChange={(e) => setType(e.target.value as DhcpFilterType)} className={cls}>
            <option value="allow">Allow</option>
            <option value="deny">Deny</option>
          </select>
          <button onClick={add} className="flex items-center gap-1.5 rounded-lg border border-accent/40 bg-[color-mix(in_oklch,var(--accent)_14%,transparent)] px-4 py-2 text-sm font-medium text-accent"><Plus size={15} /> Add</button>
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        {([['Allow list', allow, 'var(--good)'], ['Deny list', deny, 'var(--danger)']] as const).map(([title, list, color]) => (
          <Panel key={title}>
            <PanelHeader label="Filters" title={title} hint={`${list.length} entr${list.length === 1 ? 'y' : 'ies'}`} />
            <div className="border-t border-line">
              {list.length === 0 && <div className="px-5 py-5 text-center text-xs text-faint">empty</div>}
              {list.map((f) => (
                <div key={f.id} className="flex items-center gap-3 border-b border-line/50 px-5 py-2.5 last:border-0">
                  <Badge color={color}>{f.type}</Badge>
                  <span className="font-mono text-sm text-text">{f.mac}</span>
                  <button onClick={() => remove(f)} className="ml-auto text-faint hover:text-danger"><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
          </Panel>
        ))}
      </div>
    </div>
  );
}
