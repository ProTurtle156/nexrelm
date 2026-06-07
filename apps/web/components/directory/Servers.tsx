'use client';

import { Server } from 'lucide-react';
import type { AdServerInfo } from '@nexrelm/types';
import { useDir } from '@/lib/directory';
import { relTime } from '@/lib/format';
import { Panel, PanelHeader } from '@/components/ui/Panel';
import { Badge } from '@/components/ui/Badge';
import { StatusDot } from '@/components/ui/StatusDot';
import { DataTable, type Column } from '@/components/ui/DataTable';

export function Servers({ onAuthLost }: { onAuthLost: () => void }) {
  const { data, error } = useDir<AdServerInfo[]>('/api/directory/servers', 12000);
  if (error && /not connected|409/i.test(error)) {
    onAuthLost();
    return null;
  }
  const rows = data ?? [];

  const cols: Array<Column<AdServerInfo>> = [
    {
      key: 'name',
      header: 'Server',
      cell: (s) => (
        <span className="flex items-center gap-2">
          <Server size={15} className="text-warn" />
          <span>
            <span className="block text-sm font-medium text-text">{s.name}</span>
            {s.dnsName && <span className="block font-mono text-[0.66rem] text-faint">{s.dnsName}</span>}
          </span>
        </span>
      ),
    },
    { key: 'os', header: 'Operating system', cell: (s) => <span className="text-xs text-muted">{s.os ?? 'unknown'}</span> },
    {
      key: 'reach',
      header: 'Reachable',
      cell: (s) => (
        <span className="flex items-center gap-2">
          <StatusDot color={s.reachable ? 'var(--good)' : 'var(--danger)'} pulse={false} />
          <span className="text-xs text-muted">{s.reachable ? 'online' : 'no response'}</span>
        </span>
      ),
    },
    { key: 'state', header: 'Account', cell: (s) => <Badge color={s.enabled ? 'var(--good)' : 'var(--faint)'}>{s.enabled ? 'enabled' : 'disabled'}</Badge> },
    { key: 'logon', header: 'Last logon', align: 'right', cell: (s) => <span className="text-xs text-muted">{s.lastLogon ? relTime(s.lastLogon) : 'never'}</span> },
  ];

  return (
    <Panel>
      <PanelHeader label="Servers" title="Member servers" hint={`${rows.length} server${rows.length === 1 ? '' : 's'} · reachability probed live (live CPU/RAM needs an agent)`} />
      <div className="pb-2 pt-1">
        <DataTable columns={cols} rows={rows} rowKey={(s) => s.name} empty="no member servers in the directory" />
      </div>
    </Panel>
  );
}
