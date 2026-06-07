'use client';

import type { DhcpLeaseInfo } from '@nexrelm/types';
import { dhcpSend, useDhcp } from '@/lib/dhcp';
import { relTime } from '@/lib/format';
import { Panel, PanelHeader } from '@/components/ui/Panel';
import { Badge } from '@/components/ui/Badge';
import { DataTable, type Column } from '@/components/ui/DataTable';

const STATE_COLOR: Record<DhcpLeaseInfo['state'], string> = {
  active: 'var(--good)',
  offered: 'var(--warn)',
  reserved: 'var(--violet)',
  declined: 'var(--danger)',
  expired: 'var(--faint)',
  released: 'var(--faint)',
};

export function Leases({ scopeId }: { scopeId: string | null }) {
  const path = scopeId ? `/api/dhcp/leases?scopeId=${scopeId}` : '/api/dhcp/leases';
  const { data, loading, refresh } = useDhcp<DhcpLeaseInfo[]>(path, 5000, [path]);
  const rows = data ?? [];

  async function del(l: DhcpLeaseInfo) {
    await dhcpSend('DELETE', `/api/dhcp/leases/${l.ip}`);
    refresh();
  }

  const cols: Array<Column<DhcpLeaseInfo>> = [
    {
      key: 'ip',
      header: 'IP',
      cell: (l) => (
        <span className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ background: STATE_COLOR[l.state] }} />
          <span className="font-mono text-xs text-text">{l.ip}</span>
        </span>
      ),
    },
    { key: 'host', header: 'Hostname', cell: (l) => <span className="text-sm">{l.hostname ?? '—'}</span> },
    { key: 'mac', header: 'MAC', cell: (l) => <span className="font-mono text-xs text-muted">{l.mac}</span> },
    { key: 'vendor', header: 'Vendor', cell: (l) => <span className="text-xs text-muted">{l.vendor ?? '—'}</span> },
    { key: 'state', header: 'State', cell: (l) => <Badge color={STATE_COLOR[l.state]}>{l.state}</Badge> },
    { key: 'exp', header: 'Expires', align: 'right', cell: (l) => <span className="text-xs text-muted">{l.state === 'active' ? relTime(l.expiresAt) : '—'}</span> },
    { key: 'act', header: '', align: 'right', cell: (l) => <button onClick={() => del(l)} className="text-xs text-faint hover:text-danger">delete</button> },
  ];

  return (
    <Panel>
      <PanelHeader label="Address Leases" title="Active & recent leases" hint={`${rows.length} lease${rows.length === 1 ? '' : 's'}${scopeId ? ' · scoped' : ''}`} />
      <div className="pb-2 pt-1">
        <DataTable columns={cols} rows={rows} rowKey={(l) => l.id} empty={loading ? 'loading…' : 'no leases yet — the server hands them out once enabled'} />
      </div>
    </Panel>
  );
}
