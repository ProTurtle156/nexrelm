import type { Topology, TopoNode } from '@nexrelm/types';
import { categoryOf } from './nodeView';

export interface Placed {
  node: TopoNode;
  x: number;
  y: number;
  depth: number;
  angle: number;
}

export interface Edge {
  id: string;
  source: string;
  target: string;
  state: 'up' | 'degraded' | 'down';
  throughputMbps: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface Layout {
  width: number;
  height: number;
  placed: Placed[];
  edges: Edge[];
  byId: Record<string, Placed>;
}

/** Fixed coordinate space the map is drawn in; chips are positioned as a % of it. */
export const CANVAS = { W: 820, H: 700, CX: 410, CY: 350 } as const;
const RING = [0, 150, 285, 395] as const; // node radius by tree depth

// Clockwise ordering of children so categories stay grouped on the ring.
const CAT_ORDER: Record<string, number> = { infra: 0, server: 1, identity: 2, virtual: 3, other: 4 };
const orderKey = (n: TopoNode): number => {
  if (n.id === 'nexrelm') return -1;
  if (n.meta?.role === 'Domain Controller' || /·\s*DC$/.test(n.label)) return 0;
  return 1 + (CAT_ORDER[categoryOf(n)] ?? 4);
};

/**
 * A deterministic radial tidy-tree. The gateway is the root at the centre; its
 * subtree fans out over concentric rings, each node given an angular slice
 * proportional to how many leaves hang beneath it — so the dense AD cluster
 * reads as one sector and the whole thing stays compact and balanced rather
 * than sprawling left-to-right. Positions depend only on ids + link structure,
 * so live status updates never make the graph jump around.
 */
export function computeLayout(topology: Topology): Layout {
  const nodes = topology.nodes;
  const byNode = new Map(nodes.map((n) => [n.id, n] as const));
  const ids = nodes.map((n) => n.id);
  const idSet = new Set(ids);
  const links = topology.links.filter((l) => idSet.has(l.source) && idSet.has(l.target));

  const adj = new Map<string, string[]>(ids.map((id) => [id, []] as [string, string[]]));
  for (const l of links) {
    adj.get(l.source)!.push(l.target);
    adj.get(l.target)!.push(l.source);
  }

  const root = nodes.find((n) => n.kind === 'gateway')?.id ?? [...ids].sort((a, b) => adj.get(b)!.length - adj.get(a)!.length)[0] ?? ids[0];

  const depth = new Map<string, number>();
  const children = new Map<string, string[]>(ids.map((id) => [id, []] as [string, string[]]));

  if (root) {
    const seen = new Set([root]);
    depth.set(root, 0);
    const queue = [root];
    while (queue.length) {
      const u = queue.shift()!;
      const kids = adj
        .get(u)!
        .filter((v) => !seen.has(v))
        .sort((a, b) => orderKey(byNode.get(a)!) - orderKey(byNode.get(b)!) || byNode.get(a)!.label.localeCompare(byNode.get(b)!.label));
      for (const v of kids) {
        seen.add(v);
        depth.set(v, (depth.get(u) ?? 0) + 1);
        children.get(u)!.push(v);
        queue.push(v);
      }
    }
    // attach any disconnected nodes directly to the root
    for (const id of ids) {
      if (!seen.has(id)) {
        seen.add(id);
        depth.set(id, 1);
        children.get(root)!.push(id);
      }
    }
  }

  const leaves = new Map<string, number>();
  const countLeaves = (u: string): number => {
    const kids = children.get(u)!;
    if (!kids.length) {
      leaves.set(u, 1);
      return 1;
    }
    let sum = 0;
    for (const v of kids) sum += countLeaves(v);
    leaves.set(u, sum);
    return sum;
  };
  if (root) countLeaves(root);

  const angle = new Map<string, number>();
  const assign = (u: string, a0: number, a1: number): void => {
    angle.set(u, (a0 + a1) / 2);
    const kids = children.get(u)!;
    if (!kids.length) return;
    const total = leaves.get(u)!;
    let cursor = a0;
    for (const v of kids) {
      const span = (a1 - a0) * (leaves.get(v)! / total);
      assign(v, cursor, cursor + span);
      cursor += span;
    }
  };
  if (root) assign(root, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2);

  const byId: Record<string, Placed> = {};
  const placed: Placed[] = [];
  for (const id of ids) {
    const d = depth.get(id) ?? 1;
    const ang = angle.get(id) ?? 0;
    const r = RING[Math.min(d, RING.length - 1)]!;
    const x = d === 0 ? CANVAS.CX : CANVAS.CX + r * Math.cos(ang);
    const y = d === 0 ? CANVAS.CY : CANVAS.CY + r * Math.sin(ang);
    const p: Placed = { node: byNode.get(id)!, x, y, depth: d, angle: ang };
    byId[id] = p;
    placed.push(p);
  }

  const edges: Edge[] = links.map((l) => {
    const a = byId[l.source]!;
    const b = byId[l.target]!;
    return { id: l.id, source: l.source, target: l.target, state: l.state, throughputMbps: l.throughputMbps, x1: a.x, y1: a.y, x2: b.x, y2: b.y };
  });

  return { width: CANVAS.W, height: CANVAS.H, placed, edges, byId };
}
