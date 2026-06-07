/**
 * Shared presentation vocabulary for topology nodes — icon, display name,
 * cluster count and category — so the map and the node list stay in sync.
 */
import type { LucideIcon } from 'lucide-react';
import { Box, Boxes, CircleHelp, Cpu, Monitor, MonitorSmartphone, Network, Radar, Router, Server, ServerCog, Users } from 'lucide-react';
import type { TopoNode } from '@nexrelm/types';

/** Aggregate "population" nodes that carry a count instead of an address. */
export const CLUSTERS = new Set(['ad-users', 'ad-workstations', 'lan-endpoints']);

export type NodeCategory = 'infra' | 'server' | 'identity' | 'virtual' | 'other';

const isDc = (n: TopoNode): boolean => n.meta?.role === 'Domain Controller' || /·\s*DC$/.test(n.label);
const isCore = (n: TopoNode): boolean => n.id === 'nexrelm' || n.meta?.role === 'control plane';

export function iconFor(n: TopoNode): LucideIcon {
  if (n.kind === 'gateway') return Router;
  if (isCore(n)) return Radar;
  if (isDc(n)) return ServerCog;
  if (n.id === 'ad-users') return Users;
  if (n.id === 'ad-workstations') return MonitorSmartphone;
  if (n.id === 'lan-endpoints') return Boxes;
  if (n.kind === 'server') return Server;
  if (n.kind === 'vm' || n.kind === 'container') return Box;
  if (n.kind === 'iot') return Cpu;
  if (n.kind === 'host') return Monitor;
  if (n.kind === 'router' || n.kind === 'switch') return Network;
  return CircleHelp;
}

export function categoryOf(n: TopoNode): NodeCategory {
  if (n.kind === 'gateway' || n.kind === 'router' || n.kind === 'switch' || n.kind === 'firewall' || isCore(n) || isDc(n)) return 'infra';
  if (CLUSTERS.has(n.id)) return 'identity';
  if (n.kind === 'server') return 'server';
  if (n.kind === 'vm' || n.kind === 'container') return 'virtual';
  return 'other';
}

export const CATEGORY_LABEL: Record<NodeCategory, string> = {
  infra: 'Core infrastructure',
  server: 'Servers',
  identity: 'Identity & populations',
  virtual: 'Virtual machines',
  other: 'Other endpoints',
};

export function clusterCount(n: TopoNode): number | undefined {
  const v = n.meta?.users ?? n.meta?.total;
  if (typeof v === 'number') return v;
  const tail = String(n.label).split('·').pop()?.trim();
  const parsed = tail ? Number(tail.replace(/[^\d]/g, '')) : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Strip the trailing "· N" count off cluster labels (the count is shown as a badge). */
export function displayName(n: TopoNode): string {
  return CLUSTERS.has(n.id) ? n.label.split('·')[0]!.trim() : n.label;
}

/** Short role/kind caption for list rows + inspector. */
export function roleOf(n: TopoNode): string {
  return (n.meta?.role as string | undefined) ?? n.kind;
}
