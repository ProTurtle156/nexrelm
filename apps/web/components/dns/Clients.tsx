'use client';

import { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { DnsClient, DnsGroup } from '@nexrelm/types';
import { dnsSend, useDns } from '@/lib/dns';
import { relTime, num } from '@/lib/format';
import { Panel, PanelHeader } from '@/components/ui/Panel';
import { StatusDot } from '@/components/ui/StatusDot';
import { DataTable, type Column } from '@/components/ui/DataTable';

export function Clients() {
  const { data: clients, loading, refresh } = useDns<DnsClient[]>('/api/dns/clients', 6000);
  const { data: groups } = useDns<DnsGroup[]>('/api/dns/groups', 0);

  async function saveGroups(c: DnsClient, ids: number[]) {
    await dnsSend('POST', `/api/dns/clients/${c.id}/groups`, { groups: ids });
    refresh();
  }
  async function saveNickname(c: DnsClient, nickname: string) {
    await dnsSend('POST', `/api/dns/clients/${c.id}/nickname`, { nickname });
    refresh();
  }

  const cols: Array<Column<DnsClient>> = [
    {
      key: 'ip',
      header: 'Client',
      cell: (c) => {
        const primary = c.nickname || c.name || c.ip;
        const sub = [c.ip, c.name && c.name !== primary ? c.name : null].filter(Boolean).join(' · ');
        return (
          <span className="flex items-center gap-2">
            <StatusDot color="var(--good)" pulse={false} />
            <span>
              <span className="block text-xs text-text">{primary}</span>
              <span className="block font-mono text-[0.66rem] text-faint">{sub}</span>
            </span>
          </span>
        );
      },
    },
    { key: 'mac', header: 'MAC', cell: (c) => <span className="font-mono text-xs text-muted">{c.mac ?? '—'}</span> },
    { key: 'vendor', header: 'Vendor', cell: (c) => <span className="text-xs text-muted">{c.vendor ?? '—'}</span> },
    { key: 'nickname', header: 'Nickname', cell: (c) => <NicknameCell client={c} onSave={(n) => saveNickname(c, n)} /> },
    { key: 'groups', header: 'Groups', cell: (c) => <GroupsDropdown selected={c.groups} groups={groups ?? []} onSave={(ids) => saveGroups(c, ids)} /> },
    { key: 'last', header: 'Last seen', cell: (c) => <span className="text-xs text-faint">{relTime(c.lastSeen)}</span> },
    { key: 'q', header: 'Queries', align: 'right', cell: (c) => <span className="stat text-xs text-text">{num(c.queries)}</span> },
  ];

  return (
    <div className="flex flex-col gap-5">
      <Panel>
        <PanelHeader label="Clients" title="Network information stream" hint={`${clients?.length ?? 0} devices · set a nickname and assign groups inline`} />
        <div className="pb-2 pt-1">
          <DataTable columns={cols} rows={clients ?? []} rowKey={(c) => String(c.id)} empty={loading ? 'loading…' : 'no clients yet — point a device at this resolver'} />
        </div>
      </Panel>
    </div>
  );
}

// ── inline editable nickname ──────────────────────────────────────────────────────
function NicknameCell({ client, onSave }: { client: DnsClient; onSave: (nickname: string) => void }) {
  const [val, setVal] = useState(client.nickname ?? '');
  useEffect(() => setVal(client.nickname ?? ''), [client.nickname]);

  function commit() {
    const next = val.trim();
    if (next !== (client.nickname ?? '')) onSave(next);
  }

  return (
    <input
      value={val}
      onChange={(e) => setVal(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setVal(client.nickname ?? '');
          (e.target as HTMLInputElement).blur();
        }
      }}
      onBlur={commit}
      placeholder="add a name"
      className="w-28 rounded border border-line bg-[var(--bg-2)] px-2 py-1 text-xs text-text outline-none placeholder:text-faint focus:border-accent/50"
    />
  );
}

// ── groups multi-select dropdown ──────────────────────────────────────────────────
function GroupsDropdown({ selected, groups, onSave }: { selected: number[]; groups: DnsGroup[]; onSave: (ids: number[]) => void }) {
  const [open, setOpen] = useState(false);
  const groupName = (id: number): string => groups.find((g) => g.id === id)?.name ?? (id === 0 ? 'Everyone' : `#${id}`);
  const label = selected.length ? selected.map(groupName).join(', ') : 'Everyone';

  function toggle(id: number) {
    const set = new Set(selected);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    onSave([...set]);
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 rounded-lg border border-line bg-[var(--bg-2)] px-2.5 py-1 text-xs text-text transition-colors hover:border-accent/40"
      >
        <span className="max-w-[150px] truncate">{label}</span>
        <ChevronDown size={12} className={`ml-auto text-faint transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-50 mt-1 w-52 rounded-lg border border-line bg-[var(--bg-1)] p-1.5 shadow-xl">
            <p className="px-2 py-1 text-[0.65rem] uppercase tracking-wide text-faint">Member of groups</p>
            {groups.length === 0 ? (
              <p className="px-2 py-1.5 text-xs text-faint">No groups defined yet.</p>
            ) : (
              groups.map((g) => (
                <label key={g.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-text hover:bg-[var(--bg-2)]">
                  <input type="checkbox" checked={selected.includes(g.id)} onChange={() => toggle(g.id)} className="accent-[var(--accent)]" />
                  {g.name}
                </label>
              ))
            )}
            <p className="px-2 pt-1 text-[0.65rem] text-faint">None checked ⇒ Everyone (default rules).</p>
          </div>
        </>
      )}
    </div>
  );
}
