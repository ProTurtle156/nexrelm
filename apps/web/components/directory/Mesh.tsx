'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import type { DirectoryTopology } from '@nexrelm/types';

type Kind = 'domain' | 'hub' | 'dc' | 'server' | 'user' | 'device';
interface MNode {
  id: string;
  kind: Kind;
  label: string;
  x: number;
  y: number;
  r: number;
  color: string;
  labelPos: 'right' | 'below';
  /** user id this node navigates to when clicked (user node, or a device's owner) */
  userId?: string;
}
interface MEdge {
  from: string;
  to: string;
  d: string;
  color: string;
}

const W = 1000;
const VBH = 620; // viewport box height (content is fit into this)
const ROW = 30;
const BAND = 30;

function elbow(p: { x: number; y: number }, c: { x: number; y: number }): string {
  const midX = (p.x + c.x) / 2;
  return `M ${p.x} ${p.y} H ${midX} V ${c.y} H ${c.x}`;
}

function layout(topo: DirectoryTopology): { nodes: MNode[]; edges: MEdge[]; contentW: number; contentH: number } {
  const xDomain = W - 90;
  const xHub = W - 330;
  const xMember = W - 610;
  const xDevice = 80;

  const dcs = topo.dcs;
  const servers = topo.devices.filter((d) => d.isServer && !d.isDc);
  const users = topo.users;

  // device → owner-name, and a name→userId index for navigation
  const ownerOf = new Map<string, string>();
  topo.links.forEach((l) => ownerOf.set(l.device, l.user));
  const userIdByName = new Map<string, string>();
  users.forEach((u) => {
    userIdByName.set(u.id.toLowerCase(), u.id);
    userIdByName.set(u.name.toLowerCase(), u.id);
  });

  const nodes: MNode[] = [];
  const edges: MEdge[] = [];
  const memberPos = new Map<string, { x: number; y: number }>();

  let cursor = 44;
  const placeBand = (items: Array<{ id: string; name: string; admin?: boolean; enabled?: boolean }>, kind: Exclude<Kind, 'domain' | 'hub' | 'device'>): number => {
    const startY = cursor;
    if (items.length === 0) {
      const c = cursor;
      cursor += ROW + BAND;
      return c;
    }
    items.forEach((it) => {
      const y = cursor;
      cursor += ROW;
      const color = kind === 'dc' ? 'var(--accent)' : kind === 'server' ? 'var(--warn)' : it.admin ? 'var(--danger)' : it.enabled === false ? 'var(--faint)' : 'var(--violet)';
      const id = `${kind}:${it.id}`;
      nodes.push({ id, kind, label: it.name, x: xMember, y, r: kind === 'user' ? 8.5 : 10, color, labelPos: 'right', userId: kind === 'user' ? it.id : undefined });
      if (kind === 'user') memberPos.set(it.id, { x: xMember, y });
    });
    const center = (startY + cursor - ROW) / 2;
    cursor += BAND;
    return center;
  };

  const dcCenter = placeBand(dcs.map((d) => ({ id: d.id, name: d.name })), 'dc');
  const srvCenter = placeBand(servers.map((s) => ({ id: s.id, name: s.name })), 'server');
  const userCenter = placeBand(users.map((u) => ({ id: u.id, name: u.name, admin: u.admin, enabled: u.enabled })), 'user');
  const memberBottom = cursor;

  // devices grouped under owner, stacked
  const workstations = topo.devices.filter((d) => !d.isServer && !d.isDc);
  const byOwner = new Map<string, typeof workstations>();
  const orphans: typeof workstations = [];
  for (const d of workstations) {
    const ownerName = ownerOf.get(d.id);
    const uid = ownerName ? userIdByName.get(ownerName.toLowerCase()) : undefined;
    if (uid && memberPos.has(uid)) {
      const arr = byOwner.get(uid) ?? [];
      arr.push(d);
      byOwner.set(uid, arr);
    } else orphans.push(d);
  }

  let devCursor = 44;
  for (const u of users) {
    const devs = byOwner.get(u.id);
    if (!devs?.length) continue;
    const userPos = memberPos.get(u.id)!;
    for (const d of devs) {
      const y = devCursor;
      devCursor += ROW;
      const id = `device:${d.id}`;
      nodes.push({ id, kind: 'device', label: d.name, x: xDevice, y, r: 6.5, color: 'var(--good)', labelPos: 'right', userId: u.id });
      edges.push({ from: `user:${u.id}`, to: id, d: elbow(userPos, { x: xDevice, y }), color: 'var(--accent-dim)' });
    }
  }
  for (const d of orphans) {
    const y = devCursor;
    devCursor += ROW;
    nodes.push({ id: `device:${d.id}`, kind: 'device', label: d.name, x: xDevice, y, r: 6.5, color: 'var(--faint)', labelPos: 'right' });
  }

  const contentH = Math.max(memberBottom, devCursor, 200) + 24;

  const hubs = [
    { key: 'dc', label: 'Controllers', y: dcCenter, count: dcs.length },
    { key: 'server', label: 'Servers', y: srvCenter, count: servers.length },
    { key: 'user', label: 'Users', y: userCenter, count: users.length },
  ];
  hubs.forEach((h) => {
    const hubColor = h.key === 'dc' ? 'var(--accent)' : h.key === 'server' ? 'var(--warn)' : 'var(--violet)';
    nodes.push({ id: `hub:${h.key}`, kind: 'hub', label: `${h.label} (${h.count})`, x: xHub, y: h.y, r: 12, color: hubColor, labelPos: 'below' });
  });

  const domainY = (dcCenter + userCenter) / 2;
  nodes.push({ id: 'domain', kind: 'domain', label: topo.domain || 'domain', x: xDomain, y: domainY, r: 17, color: 'var(--accent)', labelPos: 'below' });
  const domainPos = { x: xDomain, y: domainY };

  hubs.forEach((h) => edges.unshift({ from: 'domain', to: `hub:${h.key}`, d: elbow(domainPos, { x: xHub, y: h.y }), color: 'var(--line-strong)' }));
  const hubY = (k: string): number => hubs.find((h) => h.key === k)!.y;
  const memberY = (id: string): number => nodes.find((n) => n.id === id)?.y ?? 0;
  dcs.forEach((d) => edges.push({ from: 'hub:dc', to: `dc:${d.id}`, d: elbow({ x: xHub, y: hubY('dc') }, { x: xMember, y: memberY(`dc:${d.id}`) }), color: 'var(--line)' }));
  servers.forEach((s) => edges.push({ from: 'hub:server', to: `server:${s.id}`, d: elbow({ x: xHub, y: hubY('server') }, { x: xMember, y: memberY(`server:${s.id}`) }), color: 'var(--line)' }));
  users.forEach((u) => edges.push({ from: 'hub:user', to: `user:${u.id}`, d: elbow({ x: xHub, y: hubY('user') }, memberPos.get(u.id)!), color: 'var(--line)' }));

  return { nodes, edges, contentW: W, contentH };
}

export function Mesh({ topo, onPickUser }: { topo: DirectoryTopology; onPickUser?: (userId: string) => void }) {
  const { nodes, edges, contentW, contentH } = useMemo(() => layout(topo), [topo]);
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState({ k: 1, tx: 0, ty: 0 });
  const [hover, setHover] = useState<string | null>(null);

  const fit = useMemo(() => {
    const pad = 46;
    const k = Math.min((W - pad * 2) / contentW, (VBH - pad * 2) / contentH);
    return { k, tx: (W - contentW * k) / 2, ty: (VBH - contentH * k) / 2 };
  }, [contentW, contentH]);
  useEffect(() => setView(fit), [fit]);

  function loc(e: { clientX: number; clientY: number }): { x: number; y: number } | null {
    const svg = svgRef.current;
    if (!svg) return null;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const p = svg.createSVGPoint();
    p.x = e.clientX;
    p.y = e.clientY;
    const r = p.matrixTransform(ctm.inverse());
    return { x: r.x, y: r.y };
  }

  // wheel zoom toward cursor (native, non-passive so we can preventDefault)
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const l = loc(e);
      if (!l) return;
      setView((v) => {
        const f = Math.exp(-e.deltaY * 0.0015);
        const k = Math.min(7, Math.max(0.2, v.k * f));
        const cx = (l.x - v.tx) / v.k;
        const cy = (l.y - v.ty) / v.k;
        return { k, tx: l.x - cx * k, ty: l.y - cy * k };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // drag to pan
  const drag = useRef<{ x: number; y: number } | null>(null);
  function bgDown(e: React.PointerEvent) {
    const l = loc(e);
    if (!l) return;
    drag.current = l;
    svgRef.current?.setPointerCapture(e.pointerId);
  }
  function move(e: React.PointerEvent) {
    if (!drag.current) return;
    const l = loc(e);
    if (!l) return;
    const dx = l.x - drag.current.x;
    const dy = l.y - drag.current.y;
    drag.current = l;
    setView((v) => ({ ...v, tx: v.tx + dx, ty: v.ty + dy }));
  }
  function up(e: React.PointerEvent) {
    drag.current = null;
    svgRef.current?.releasePointerCapture?.(e.pointerId);
  }

  const zoomBy = (f: number) => setView((v) => ({ ...v, k: Math.min(7, Math.max(0.2, v.k * f)) }));

  const neighbors = useMemo(() => {
    if (!hover) return null;
    const s = new Set<string>([hover]);
    edges.forEach((e) => {
      if (e.from === hover) s.add(e.to);
      if (e.to === hover) s.add(e.from);
    });
    return s;
  }, [hover, edges]);

  function click(n: MNode) {
    if (n.userId && onPickUser) onPickUser(n.userId);
  }

  return (
    <div ref={wrapRef} className="relative w-full overflow-hidden rounded-xl border border-line bg-[var(--bg-1)]" style={{ height: 'clamp(380px, 62vh, 660px)', touchAction: 'none' }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${VBH}`}
        width="100%"
        height="100%"
        className="select-none"
        style={{ cursor: drag.current ? 'grabbing' : 'grab' }}
        role="img"
        aria-label="Directory hierarchy"
        onPointerDown={bgDown}
        onPointerMove={move}
        onPointerUp={up}
        onPointerLeave={up}
      >
        <g transform={`translate(${view.tx} ${view.ty}) scale(${view.k})`}>
          <g>
            {edges.map((e, i) => {
              const lit = hover ? e.from === hover || e.to === hover : false;
              const op = hover ? (lit ? 0.95 : 0.1) : 0.5;
              return <path key={i} d={e.d} fill="none" stroke={lit ? 'var(--accent)' : e.color} strokeWidth={lit ? 1.8 : 1} strokeOpacity={op} style={{ transition: 'stroke-opacity .15s' }} />;
            })}
          </g>
          <g>
            {nodes.map((n) => {
              const isHover = hover === n.id;
              const dim = neighbors ? !neighbors.has(n.id) : false;
              const clickable = !!n.userId;
              const r = isHover ? n.r + 3 : n.r;
              return (
                <g
                  key={n.id}
                  transform={`translate(${n.x} ${n.y})`}
                  style={{ cursor: clickable ? 'pointer' : 'inherit', opacity: dim ? 0.28 : 1, transition: 'opacity .15s' }}
                  onMouseEnter={() => setHover(n.id)}
                  onMouseLeave={() => setHover((h) => (h === n.id ? null : h))}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => click(n)}
                >
                  <title>{`${n.kind}: ${n.label}${clickable ? ' — click to open user' : ''}`}</title>
                  {(n.kind === 'domain' || n.kind === 'hub' || isHover) && <circle r={r + 7} fill={n.color} style={{ filter: 'blur(7px)', opacity: isHover ? 0.4 : 0.2 }} />}
                  <circle r={r} fill="var(--bg-2)" stroke={n.color} strokeWidth={n.kind === 'domain' ? 2.4 : n.kind === 'hub' ? 2 : isHover ? 2.2 : 1.6} style={{ filter: n.kind === 'domain' || n.kind === 'hub' || isHover ? `drop-shadow(0 0 5px ${n.color})` : 'none', transition: 'r .12s' }} />
                  <circle r={r * 0.32} fill={n.color} />
                  {n.labelPos === 'below' ? (
                    <text y={r + 14} textAnchor="middle" className="fill-muted font-mono" style={{ fontSize: n.kind === 'domain' ? 12 : 10.5, fontWeight: isHover ? 600 : 400 }}>
                      {n.label}
                    </text>
                  ) : (
                    <text x={r + 7} y={3.5} textAnchor="start" className={n.kind === 'device' && !isHover ? 'fill-faint font-mono' : 'fill-text font-mono'} style={{ fontSize: n.kind === 'user' ? 10 : 9.5, fontWeight: isHover ? 600 : 400 }}>
                      {n.label}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </g>
      </svg>

      {/* zoom controls + hint */}
      <div className="absolute right-3 top-3 flex flex-col gap-1.5">
        <CtrlBtn onClick={() => zoomBy(1.25)} title="zoom in"><ZoomIn size={15} /></CtrlBtn>
        <CtrlBtn onClick={() => zoomBy(0.8)} title="zoom out"><ZoomOut size={15} /></CtrlBtn>
        <CtrlBtn onClick={() => setView(fit)} title="fit to view"><Maximize2 size={15} /></CtrlBtn>
      </div>
      <div className="pointer-events-none absolute bottom-2.5 left-3 font-mono text-[0.62rem] text-faint">scroll to zoom · drag to pan · click a user or device to open it</div>
    </div>
  );
}

function CtrlBtn({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button onClick={onClick} title={title} className="grid h-7 w-7 place-items-center rounded-lg border border-line bg-[var(--bg-2)]/80 text-muted backdrop-blur transition-colors hover:text-accent">
      {children}
    </button>
  );
}
