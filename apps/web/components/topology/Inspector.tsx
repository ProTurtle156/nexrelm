'use client';

import type { TopoNode, Topology } from '@nexrelm/types';
import { Panel, PanelHeader } from '@/components/ui/Panel';
import { Badge } from '@/components/ui/Badge';
import { stateVar } from '@/lib/ui';
import { cn } from '@/lib/format';
import { displayName, iconFor, roleOf } from './nodeView';

export function Inspector({ node, topology }: { node: TopoNode | null; topology: Topology }) {
  if (!node) {
    return (
      <Panel>
        <PanelHeader label="Inspector" title="Select a node" />
        <div className="px-5 pb-6 pt-3 text-sm text-muted">
          <p>Pick a node on the map to see what it actually is — address, OS and live status for a host, or population counts for an identity group.</p>
        </div>
      </Panel>
    );
  }
  const Icon = iconFor(node);
  const color = stateVar(node.status);
  const links = topology.links.filter((l) => l.source === node.id || l.target === node.id).length;
  const rows = inspectorRows(node);
  return (
    <Panel>
      <PanelHeader label="Inspector" title={displayName(node)} />
      <div className="flex flex-col gap-4 px-5 pb-5 pt-3">
        <div className="flex items-center gap-3">
          <span
            className="grid h-12 w-12 shrink-0 place-items-center rounded-xl border"
            style={{ color, borderColor: `color-mix(in oklch, ${color} 50%, transparent)`, background: `color-mix(in oklch, ${color} 14%, var(--bg-2))` }}
          >
            <Icon size={22} strokeWidth={1.6} />
          </span>
          <div className="flex flex-wrap gap-2">
            <Badge color={color}>{node.status}</Badge>
            <Badge color="var(--accent-dim)">{roleOf(node)}</Badge>
          </div>
        </div>
        {rows.length > 0 && (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
            {rows.map(([label, value, mono]) => (
              <div key={label} className="min-w-0">
                <dt className="label">{label}</dt>
                <dd className={cn('mt-0.5 truncate text-text', mono ? 'font-mono text-xs' : 'text-sm')} title={value}>
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        )}
        <div className="panel-2 px-3 py-2 text-xs text-muted">
          Connected links<span className="stat ml-2 text-text">{links}</span>
        </div>
      </div>
    </Panel>
  );
}

/** Only the facts that exist for this node — no empty "IP: —" / "VLAN: —" rows. */
function inspectorRows(n: TopoNode): Array<[string, string, boolean?]> {
  const r: Array<[string, string, boolean?]> = [];
  const m = n.meta ?? {};
  if (n.ip) r.push(['IP address', n.ip, true]);
  if (n.mac) r.push(['MAC', n.mac, true]);
  if (m.os) r.push(['Operating system', String(m.os)]);
  if (m.domain) r.push(['Domain', String(m.domain)]);
  if (m.vendor) r.push(['Vendor', String(m.vendor)]);
  if (m.openPorts !== undefined) r.push(['Open ports', String(m.openPorts)]);
  if (m.users !== undefined) r.push(['Users', String(m.users)]);
  if (m.admins !== undefined) r.push(['Admins', String(m.admins)]);
  if (m.groups !== undefined) r.push(['Groups', String(m.groups)]);
  if (m.computers !== undefined) r.push(['Computers', String(m.computers)]);
  if (m.total !== undefined) r.push(['Total', String(m.total)]);
  if (m.online !== undefined) r.push(['Online', String(m.online)]);
  if (m.offline !== undefined) r.push(['Offline', String(m.offline)]);
  if (m.risk) r.push(['Risk', String(m.risk)]);
  if (m.examples) r.push(['Examples', String(m.examples)]);
  return r;
}

export function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-2 text-xs text-muted">
      <span className="h-2.5 w-2.5 rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
      {label}
    </span>
  );
}
