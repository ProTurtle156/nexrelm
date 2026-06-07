'use client';

import { useMemo, useState } from 'react';
import type { DnsQuery, QueryStatus } from '@nexrelm/types';
import { useDns } from '@/lib/dns';
import { hms } from '@/lib/format';
import { cn } from '@/lib/format';
import { Panel, PanelHeader } from '@/components/ui/Panel';
import { Badge } from '@/components/ui/Badge';
import { DataTable, type Column } from '@/components/ui/DataTable';

const STATUS_COLOR: Record<QueryStatus, string> = {
  blocked: 'var(--danger)',
  forwarded: 'var(--accent-dim)',
  cached: 'var(--violet)',
  allowed: 'var(--good)',
  nxdomain: 'var(--faint)',
  refused: 'var(--warn)',
  local: 'var(--faint)',
};

const FILTERS: Array<QueryStatus | 'all'> = ['all', 'blocked', 'forwarded', 'cached', 'allowed', 'refused'];

export function QueryLog() {
  const [status, setStatus] = useState<QueryStatus | 'all'>('all');
  const [domain, setDomain] = useState('');
  const [client, setClient] = useState('');
  const path = useMemo(() => {
    const p = new URLSearchParams({ limit: '300' });
    if (status !== 'all') p.set('status', status);
    if (domain.trim()) p.set('domain', domain.trim());
    if (client.trim()) p.set('client', client.trim());
    return `/api/dns/queries?${p.toString()}`;
  }, [status, domain, client]);

  const { data, loading } = useDns<DnsQuery[]>(path, 2000, [path]);
  const rows = data ?? [];

  const cols: Array<Column<DnsQuery>> = [
    { key: 'ts', header: 'Time', cell: (q) => <span className="font-mono text-xs text-faint">{hms(q.ts)}</span> },
    { key: 'status', header: 'Status', cell: (q) => <Badge color={STATUS_COLOR[q.status]}>{q.status}</Badge> },
    { key: 'domain', header: 'Domain', cell: (q) => <span className="font-mono text-xs text-text">{q.domain}</span> },
    { key: 'type', header: 'Type', cell: (q) => <span className="font-mono text-xs text-muted">{q.type}</span> },
    {
      key: 'client',
      header: 'Client',
      cell: (q) => (
        <span className="font-mono text-xs">
          {q.clientName ? <span className="text-text">{q.clientName}</span> : <span className="text-muted">{q.client}</span>}
        </span>
      ),
    },
    { key: 'reply', header: 'Reply', cell: (q) => <span className="font-mono text-xs text-muted">{q.reply ?? '—'}</span> },
    { key: 'upstream', header: 'Upstream', cell: (q) => <span className="font-mono text-[0.7rem] text-faint">{q.upstream ?? '—'}</span> },
    { key: 'ms', header: 'ms', align: 'right', cell: (q) => <span className="stat text-xs text-muted">{q.replyMs}</span> },
  ];

  return (
    <Panel>
      <PanelHeader label="Query Log" title="Live DNS queries" hint={`${rows.length} shown · refreshes every 2s`} />
      <div className="flex flex-wrap items-center gap-2 px-5 py-3">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setStatus(f)}
            className={cn(
              'rounded-full border px-3 py-1 font-mono text-[0.68rem] uppercase tracking-wider transition-colors',
              status === f ? 'border-accent/40 bg-[color-mix(in_oklch,var(--accent)_14%,transparent)] text-accent' : 'border-line text-muted hover:text-text',
            )}
          >
            {f}
          </button>
        ))}
        <input
          value={client}
          onChange={(e) => setClient(e.target.value)}
          placeholder="filter client (ip / name)…"
          className="ml-auto w-44 rounded-lg border border-line bg-[var(--bg-2)] px-3 py-1.5 font-mono text-xs text-text outline-none placeholder:text-faint focus:border-accent/50"
        />
        <input
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          placeholder="filter domain…"
          className="w-44 rounded-lg border border-line bg-[var(--bg-2)] px-3 py-1.5 font-mono text-xs text-text outline-none placeholder:text-faint focus:border-accent/50"
        />
      </div>
      <div className="border-t border-line">
        <DataTable columns={cols} rows={rows} rowKey={(q) => String(q.id)} empty={loading ? 'loading…' : 'no queries match'} />
      </div>
    </Panel>
  );
}
