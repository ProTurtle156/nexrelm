'use client';

import { useMemo, type CSSProperties } from 'react';
import type { Topology } from '@nexrelm/types';
import { stateVar } from '@/lib/ui';
import { cn } from '@/lib/format';
import { CANVAS, computeLayout, type Edge } from './layout';
import { CLUSTERS, clusterCount, displayName, iconFor } from './nodeView';

interface TopologyGraphProps {
  topology: Topology;
  compact?: boolean;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  className?: string;
}

// Gentle inward bow toward the centre so spokes read as a radiating hub.
function edgePath(e: Edge): string {
  const mx = (e.x1 + e.x2) / 2;
  const my = (e.y1 + e.y2) / 2;
  const cx = mx + (CANVAS.CX - mx) * 0.16;
  const cy = my + (CANVAS.CY - my) * 0.16;
  return `M ${e.x1} ${e.y1} Q ${cx} ${cy} ${e.x2} ${e.y2}`;
}

export function TopologyGraph({ topology, compact = false, selectedId, onSelect, className }: TopologyGraphProps) {
  const layout = useMemo(() => computeLayout(topology), [topology]);

  const neighbors = useMemo(() => {
    const s = new Set<string>();
    if (!selectedId) return s;
    for (const e of layout.edges) {
      if (e.source === selectedId) s.add(e.target);
      if (e.target === selectedId) s.add(e.source);
    }
    return s;
  }, [selectedId, layout.edges]);

  return (
    <div className={cn('topo-map', className)} data-compact={compact} style={{ aspectRatio: `${CANVAS.W} / ${CANVAS.H}` }}>
      <svg viewBox={`0 0 ${CANVAS.W} ${CANVAS.H}`} preserveAspectRatio="xMidYMid meet" className="absolute inset-0 h-full w-full" aria-hidden>
        {!compact &&
          [150, 285].map((r) => (
            <circle key={r} cx={CANVAS.CX} cy={CANVAS.CY} r={r} fill="none" stroke="var(--line)" strokeWidth={1} strokeDasharray="2 8" strokeOpacity={0.55} />
          ))}
        {layout.edges.map((e) => {
          const color = stateVar(e.state);
          const active = !!selectedId && (e.source === selectedId || e.target === selectedId);
          const dim = !!selectedId && !active;
          const speed = Math.max(4, 16 - (e.throughputMbps / 1000) * 12);
          return (
            <g key={e.id} style={{ opacity: dim ? 0.1 : 1, transition: 'opacity 0.3s' }}>
              <path d={edgePath(e)} fill="none" stroke={color} strokeOpacity={0.16} strokeWidth={active ? 2 : 1.2} />
              <path
                d={edgePath(e)}
                fill="none"
                stroke={color}
                strokeOpacity={0.6}
                strokeWidth={active ? 2 : 1.2}
                strokeDasharray="2 8"
                strokeLinecap="round"
                style={{ animation: `flow ${speed}s linear infinite` }}
              />
            </g>
          );
        })}
      </svg>

      {layout.placed.map(({ node, x, y, depth }) => {
        const Icon = iconFor(node);
        const color = stateVar(node.status);
        const isCluster = CLUSTERS.has(node.id);
        const isCenter = depth === 0;
        const selected = node.id === selectedId;
        const dim = !!selectedId && !selected && !neighbors.has(node.id);
        const count = isCluster ? clusterCount(node) : undefined;
        const size = compact ? (isCenter ? 19 : isCluster ? 17 : 15) : isCenter ? 28 : isCluster ? 24 : 20;
        const style = { left: `${(x / CANVAS.W) * 100}%`, top: `${(y / CANVAS.H) * 100}%`, '--c': color } as unknown as CSSProperties;
        return (
          <button
            key={node.id}
            type="button"
            className="topo-node"
            data-selected={selected}
            data-dim={dim}
            style={style}
            onClick={onSelect ? () => onSelect(node.id) : undefined}
            aria-label={`${node.label} — ${node.status}`}
          >
            <span className={cn('topo-disc', isCenter && 'topo-disc--center', isCluster && 'topo-disc--cluster')}>
              <Icon size={size} strokeWidth={1.6} />
              {!compact && <span className={cn('topo-status', node.status === 'online' && 'animate-pulse-dot')} />}
              {count !== undefined && <span className="topo-count">{count}</span>}
            </span>
            {!compact && <span className="topo-name">{displayName(node)}</span>}
          </button>
        );
      })}
    </div>
  );
}
