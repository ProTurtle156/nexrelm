'use client';

import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { DnsGroup } from '@nexrelm/types';
import { dnsSend, useDns } from '@/lib/dns';
import { Panel, PanelHeader } from '@/components/ui/Panel';
import { Badge } from '@/components/ui/Badge';
import { StatusDot } from '@/components/ui/StatusDot';

export function Groups() {
  const { data: groups, refresh } = useDns<DnsGroup[]>('/api/dns/groups', 0);
  const [name, setName] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await dnsSend('POST', '/api/dns/groups', { name: name.trim(), comment: comment.trim() || undefined });
      setName('');
      setComment('');
      refresh();
    } finally {
      setBusy(false);
    }
  }
  async function toggle(g: DnsGroup) {
    await dnsSend('PATCH', `/api/dns/groups/${g.id}`, { enabled: !g.enabled });
    refresh();
  }
  async function remove(g: DnsGroup) {
    await dnsSend('DELETE', `/api/dns/groups/${g.id}`);
    refresh();
  }

  return (
    <Panel>
      <PanelHeader
        label="Groups"
        title="Client groups"
        hint="bundle lists and apply them to selected clients · the Default group applies to everyone unassigned"
      />
      <div className="flex flex-wrap gap-2 px-5 py-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder="group name (e.g. Kids, IoT, Guests)"
          className="flex-1 rounded-lg border border-line bg-[var(--bg-2)] px-3 py-2 text-sm text-text outline-none placeholder:text-faint focus:border-accent/50"
        />
        <input
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder="comment (optional)"
          className="flex-1 rounded-lg border border-line bg-[var(--bg-2)] px-3 py-2 text-sm text-text outline-none placeholder:text-faint focus:border-accent/50"
        />
        <button onClick={add} disabled={busy} className="flex items-center gap-1.5 rounded-lg border border-accent/40 bg-[color-mix(in_oklch,var(--accent)_14%,transparent)] px-4 py-2 text-sm font-medium text-accent disabled:opacity-50">
          <Plus size={15} /> Add group
        </button>
      </div>
      <div className="border-t border-line">
        {(groups ?? []).map((g) => (
          <div key={g.id} className="flex items-center gap-3 border-b border-line/50 px-5 py-3 last:border-0">
            <button onClick={() => toggle(g)} title={g.enabled ? 'disable' : 'enable'}>
              <StatusDot color={g.enabled ? 'var(--good)' : 'var(--faint)'} pulse={false} />
            </button>
            <span className="text-sm font-medium text-text">{g.name}</span>
            {g.id === 0 && <Badge color="var(--accent-dim)">default</Badge>}
            {g.comment && <span className="text-xs text-faint">{g.comment}</span>}
            {g.id !== 0 && (
              <button onClick={() => remove(g)} className="ml-auto text-faint transition-colors hover:text-danger" title="delete">
                <Trash2 size={14} />
              </button>
            )}
          </div>
        ))}
      </div>
    </Panel>
  );
}
