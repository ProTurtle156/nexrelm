'use client';

import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { DhcpReservation, DhcpReservationType } from '@nexrelm/types';
import { dhcpSend, useDhcp } from '@/lib/dhcp';
import { Panel, PanelHeader } from '@/components/ui/Panel';
import { Badge } from '@/components/ui/Badge';

export function Reservations({ scopeId }: { scopeId: string | null }) {
  const path = scopeId ? `/api/dhcp/reservations?scopeId=${scopeId}` : '/api/dhcp/reservations';
  const { data, refresh } = useDhcp<DhcpReservation[]>(path, 0, [path]);
  const [ip, setIp] = useState('');
  const [mac, setMac] = useState('');
  const [name, setName] = useState('');
  const [supported, setSupported] = useState<DhcpReservationType>('both');
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!scopeId || !ip || !mac) return;
    setBusy(true);
    try {
      await dhcpSend('POST', '/api/dhcp/reservations', { scopeId, ip, mac, name: name || undefined, supported });
      setIp(''); setMac(''); setName('');
      refresh();
    } finally {
      setBusy(false);
    }
  }
  async function remove(r: DhcpReservation) {
    await dhcpSend('DELETE', `/api/dhcp/reservations/${r.id}`);
    refresh();
  }

  const cls = 'rounded-lg border border-line bg-[var(--bg-2)] px-3 py-2 font-mono text-sm text-text outline-none placeholder:text-faint focus:border-accent/50';

  return (
    <Panel>
      <PanelHeader label="Reservations" title="Static address assignments" hint={scopeId ? 'a fixed IP for a MAC, always' : 'select a scope to add reservations'} />
      {scopeId && (
        <div className="flex flex-wrap items-center gap-2 px-5 py-3">
          <input value={ip} onChange={(e) => setIp(e.target.value)} placeholder="192.168.1.50" className={cls + ' w-36'} />
          <input value={mac} onChange={(e) => setMac(e.target.value)} placeholder="aa:bb:cc:dd:ee:ff" className={cls + ' w-44'} />
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="name (optional)" className={cls + ' flex-1'} />
          <select value={supported} onChange={(e) => setSupported(e.target.value as DhcpReservationType)} className={cls}>
            <option value="both">DHCP + BOOTP</option>
            <option value="dhcp">DHCP only</option>
            <option value="bootp">BOOTP only</option>
          </select>
          <button onClick={add} disabled={busy} className="flex items-center gap-1.5 rounded-lg border border-accent/40 bg-[color-mix(in_oklch,var(--accent)_14%,transparent)] px-4 py-2 text-sm font-medium text-accent disabled:opacity-50">
            <Plus size={15} /> Reserve
          </button>
        </div>
      )}
      <div className="border-t border-line">
        {(data ?? []).length === 0 && <div className="px-5 py-6 text-center text-sm text-faint">no reservations</div>}
        {(data ?? []).map((r) => (
          <div key={r.id} className="flex flex-wrap items-center gap-3 border-b border-line/50 px-5 py-2.5 last:border-0">
            <span className="font-mono text-sm text-text">{r.ip}</span>
            <span className="font-mono text-xs text-muted">{r.mac}</span>
            {r.name && <span className="text-sm text-muted">{r.name}</span>}
            <Badge color="var(--accent-dim)">{r.supported}</Badge>
            <button onClick={() => remove(r)} className="ml-auto text-faint hover:text-danger" title="delete"><Trash2 size={14} /></button>
          </div>
        ))}
      </div>
    </Panel>
  );
}
