'use client';

import type { TopoNode, Topology } from '@nexrelm/types';
import { Panel, PanelHeader } from '@/components/ui/Panel';
import { stateVar } from '@/lib/ui';
import { num } from '@/lib/format';
import { CATEGORY_LABEL, CLUSTERS, categoryOf, clusterCount, displayName, iconFor, roleOf, type NodeCategory } from './nodeView';

const SECTION_ORDER: NodeCategory[] = ['infra', 'server', 'identity', 'virtual', 'other'];

/** The categorized inventory — only the fields that fit each node type. */
export function NodeSections({ topology, selectedId, onSelect }: { topology: Topology; selectedId: string | null; onSelect: (id: string) => void }) {
  const sections = SECTION_ORDER.map((cat) => ({ cat, items: topology.nodes.filter((n) => categoryOf(n) === cat) })).filter((s) => s.items.length);
  return (
    <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
      {sections.map((s) => (
        <Panel key={s.cat}>
          <PanelHeader label={CATEGORY_LABEL[s.cat]} hint={`${s.items.length} ${s.items.length === 1 ? 'node' : 'nodes'}`} />
          <div className="flex flex-col gap-1 px-3 pb-3 pt-1">
            {s.items.map((n) => (
              <NodeRow key={n.id} node={n} active={n.id === selectedId} onClick={() => onSelect(n.id)} />
            ))}
          </div>
        </Panel>
      ))}
    </div>
  );
}

function NodeRow({ node, active, onClick }: { node: TopoNode; active: boolean; onClick: () => void }) {
  const Icon = iconFor(node);
  const color = stateVar(node.status);
  const count = CLUSTERS.has(node.id) ? clusterCount(node) : undefined;
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-surface-2"
      style={active ? { background: 'color-mix(in oklch, var(--accent) 12%, transparent)' } : undefined}
    >
      <span
        className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border"
        style={{ color, borderColor: `color-mix(in oklch, ${color} 45%, transparent)`, background: `color-mix(in oklch, ${color} 12%, var(--bg-2))` }}
      >
        <Icon size={16} strokeWidth={1.7} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-text">{displayName(node)}</span>
        <span className="block truncate text-[0.7rem] capitalize text-muted">{roleOf(node)}</span>
      </span>
      <span className="shrink-0 text-right">
        {count !== undefined ? (
          <span className="stat text-sm text-text">{num(count)}</span>
        ) : node.ip ? (
          <span className="font-mono text-xs text-muted">{node.ip}</span>
        ) : (
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
        )}
      </span>
    </button>
  );
}
