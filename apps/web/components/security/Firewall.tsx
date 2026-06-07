'use client';

import { useState } from 'react';
import { Plus, Trash2, ChevronUp, ChevronDown, Shield, Download, ArrowDownToLine, ArrowUpFromLine, Zap } from 'lucide-react';
import type { ActiveResponseState, FirewallState, FwRule, FwTrust, SecSeverity } from '@nexrelm/types';
import { useSec, secSend, SEC_API } from '@/lib/security';
import { cn, num } from '@/lib/format';
import { Panel, PanelHeader } from '@/components/ui/Panel';
import { Badge } from '@/components/ui/Badge';
import { StatusDot } from '@/components/ui/StatusDot';
import { TrafficLeaders } from '@/components/security/TrafficLeaders';

const cls = 'rounded-lg border border-line bg-[var(--bg-2)] px-2.5 py-2 text-sm text-text outline-none focus:border-accent/50';
const ACTION_COLOR: Record<FwRule['action'], string> = { allow: 'var(--good)', deny: 'var(--warn)', drop: 'var(--danger)' };
const TRUST_COLOR: Record<FwTrust, string> = { trusted: 'var(--good)', internal: 'var(--accent)', dmz: 'var(--warn)', guest: 'var(--violet)', untrusted: 'var(--danger)' };
const VERB: Record<FwRule['action'], string> = { allow: 'Allow', deny: 'Refuse', drop: 'Silently block' };

function describe(r: FwRule, fw: FirewallState): string {
  const who = r.source === 'any' || r.source === '' ? 'anyone' : r.source.startsWith('zone:') ? `the ${fw.zones.find((z) => z.id === r.source.slice(5))?.name ?? 'zone'} zone` : r.source;
  const where = r.direction === 'inbound' ? 'coming in' : 'going out';
  const svc = r.port !== 'any' ? ` on port ${r.port}` : '';
  const proto = r.proto !== 'any' ? ` ${r.proto.toUpperCase()}` : '';
  return `${VERB[r.action]}${proto} traffic ${where} from ${who}${svc}.`;
}

function Template({ onClick, label }: { onClick: () => void; label: string }) {
  return <button onClick={onClick} className="rounded-full border border-accent/30 bg-[color-mix(in_oklch,var(--accent)_8%,transparent)] px-2.5 py-1 text-accent hover:border-accent/50">{label}</button>;
}

export function Firewall() {
  const { data, refresh } = useSec<FirewallState>('/api/security/firewall', 0);
  const [nft, setNft] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const fw = data ?? { zones: [], rules: [], enforced: true };

  async function showExport() {
    const res = await fetch(`${SEC_API}/api/security/firewall/export`);
    setNft(await res.text());
  }

  return (
    <div className="flex flex-col gap-5">
      <Panel brackets>
        <PanelHeader
          label="Firewall"
          title="Policy & ACL"
          hint="ordered rules · zones · top rule wins"
          right={
            <div className="flex items-center gap-2">
              <button onClick={showExport} className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs text-muted hover:text-text"><Download size={13} /> Apply to router</button>
              <label className="flex items-center gap-1.5 text-xs text-muted">
                <input type="checkbox" checked={fw.enforced} onChange={(e) => secSend('POST', '/api/security/firewall/enforce', { enforced: e.target.checked }).then(refresh)} className="accent-[var(--accent)]" />
                Enforce at Nexrelm surface
              </label>
            </div>
          }
        />
        <p className="px-5 pb-4 text-xs text-faint">Rules run top → bottom; the first match wins. Nexrelm enforces deny/drop on its own services (DNS) and the export applies these to a Linux router (<span className="font-mono">sudo nft -f</span>) — consumer routers: recreate them in the firewall settings.</p>
      </Panel>

      <TrafficLeaders />

      {nft && (
        <Panel>
          <PanelHeader label="Apply" title="Protect the whole network" hint="these belong on your router" right={<button onClick={() => { setNft(null); setAdvanced(false); }} className="text-xs text-faint hover:text-text">close</button>} />
          <div className="px-5 pb-5 pt-2">
            <p className="mb-3 text-xs text-muted">Your rules in plain English:</p>
            <div className="mb-3 flex flex-col gap-1.5">
              {fw.rules.filter((r) => r.enabled).length === 0 && <p className="text-xs text-faint">No active rules.</p>}
              {fw.rules.filter((r) => r.enabled).map((r) => (
                <div key={r.id} className="flex items-center gap-2 rounded-lg border border-line bg-[var(--bg-2)]/40 px-3 py-2 text-xs">
                  <Badge color={ACTION_COLOR[r.action]}>{r.action}</Badge>
                  <span className="text-muted">{describe(r, fw)}</span>
                </div>
              ))}
            </div>
            <button onClick={() => setAdvanced((v) => !v)} className="text-xs text-faint hover:text-text">{advanced ? '▾' : '▸'} Advanced: raw nftables script</button>
            {advanced && <pre className="mt-2 max-h-64 overflow-auto rounded-lg border border-line bg-[var(--bg-1)] p-3 font-mono text-[0.68rem] text-muted no-scrollbar">{nft}</pre>}
          </div>
        </Panel>
      )}

      <Rules fw={fw} onChange={refresh} />
      <ActiveResponse />
      <Zones fw={fw} onChange={refresh} />
    </div>
  );
}

function Rules({ fw, onChange }: { fw: FirewallState; onChange: () => void }) {
  const [f, setF] = useState({ direction: 'inbound', action: 'deny', proto: 'any', source: 'any', dest: 'any', port: 'any', comment: '' });
  const zoneName = (src: string) => (src.startsWith('zone:') ? `Zone: ${fw.zones.find((z) => z.id === src.slice(5))?.name ?? src.slice(5)}` : src);

  async function add() {
    await secSend('POST', '/api/security/firewall/rules', f);
    setF({ ...f, source: 'any', port: 'any', comment: '' });
    onChange();
  }

  return (
    <Panel>
      <PanelHeader label="ACL" title="Rule chain" hint={`${fw.rules.length} rule${fw.rules.length === 1 ? '' : 's'} · evaluated top → bottom`} right={<Shield size={16} className="text-accent" />} />

      <div className="grid grid-cols-2 gap-2 border-y border-line bg-[var(--bg-2)]/40 px-5 py-3 md:grid-cols-7">
        <select value={f.direction} onChange={(e) => setF({ ...f, direction: e.target.value })} className={cls}><option value="inbound">inbound</option><option value="outbound">outbound</option></select>
        <select value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })} className={cls}><option value="allow">allow</option><option value="deny">deny</option><option value="drop">drop</option></select>
        <select value={f.proto} onChange={(e) => setF({ ...f, proto: e.target.value })} className={cls}><option value="any">any</option><option value="tcp">tcp</option><option value="udp">udp</option><option value="icmp">icmp</option></select>
        <input value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} placeholder="source" className={cls} />
        <input value={f.dest} onChange={(e) => setF({ ...f, dest: e.target.value })} placeholder="dest" className={cls} />
        <input value={f.port} onChange={(e) => setF({ ...f, port: e.target.value })} placeholder="port" className={cls} />
        <button onClick={add} className="flex items-center justify-center gap-1.5 rounded-lg border border-accent/40 bg-[color-mix(in_oklch,var(--accent)_14%,transparent)] px-3 py-2 text-sm font-medium text-accent"><Plus size={14} /> Add</button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 px-5 pt-2 text-xs text-faint">
        source =
        <button onClick={() => setF({ ...f, source: 'any' })} className="rounded border border-line px-1.5 hover:text-text">anywhere</button>
        {fw.zones.map((z) => <button key={z.id} onClick={() => setF({ ...f, source: `zone:${z.id}` })} className="rounded border border-line px-1.5 hover:text-text">{z.name}</button>)}
        <span className="text-[0.62rem]">or a device IP / range like 192.168.1.42 or 192.168.1.0/24</span>
      </div>
      <div className="grid gap-1.5 px-5 py-2.5 text-[0.7rem] text-faint sm:grid-cols-2">
        <span><b className="text-muted">Direction</b> — inbound = coming to the network; outbound = your devices reaching out.</span>
        <span><b className="text-muted">Action</b> — allow (let through) · deny (refuse, sender told) · drop (silently discard).</span>
        <span><b className="text-muted">Source / Dest</b> — a zone, a device IP, a range (CIDR), or anywhere.</span>
        <span><b className="text-muted">Port</b> — the service: 443 HTTPS · 22 SSH · 3389 RDP · 23 Telnet… or “any”.</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 px-5 pb-2 text-xs">
        <span className="text-faint">Templates:</span>
        <Template onClick={() => setF({ direction: 'outbound', action: 'drop', proto: 'any', source: '', dest: 'any', port: 'any', comment: 'block this device from the internet' })} label="Block a device from internet" />
        <Template onClick={() => setF({ direction: 'inbound', action: 'drop', proto: 'tcp', source: 'zone:wan', dest: 'any', port: '3389', comment: 'block RDP from the internet' })} label="Block a risky port from outside" />
        <Template onClick={() => setF({ direction: 'inbound', action: 'allow', proto: 'tcp', source: 'zone:lan', dest: 'any', port: '443', comment: 'allow HTTPS from LAN only' })} label="Allow a service to LAN only" />
      </div>

      <div className="max-h-[420px] overflow-y-auto border-t border-line">
        {fw.rules.length === 0 && <div className="px-5 py-8 text-center text-sm text-faint">no rules — default is allow</div>}
        {fw.rules.map((r, i) => (
          <div key={r.id} className="flex flex-wrap items-center gap-3 border-b border-line/50 px-5 py-2.5 last:border-0" title={describe(r, fw)}>
            <div className="flex flex-col">
              <button onClick={() => secSend('POST', `/api/security/firewall/rules/${r.id}/reorder`, { dir: -1 }).then(onChange)} disabled={i === 0} className="text-faint hover:text-accent disabled:opacity-25"><ChevronUp size={13} /></button>
              <button onClick={() => secSend('POST', `/api/security/firewall/rules/${r.id}/reorder`, { dir: 1 }).then(onChange)} disabled={i === fw.rules.length - 1} className="text-faint hover:text-accent disabled:opacity-25"><ChevronDown size={13} /></button>
            </div>
            <button onClick={() => secSend('PATCH', `/api/security/firewall/rules/${r.id}`, { enabled: !r.enabled }).then(onChange)}><StatusDot color={r.enabled ? 'var(--good)' : 'var(--faint)'} pulse={false} /></button>
            {r.direction === 'inbound' ? <ArrowDownToLine size={14} className="text-accent-dim" /> : <ArrowUpFromLine size={14} className="text-violet" />}
            <Badge color={ACTION_COLOR[r.action]}>{r.action}</Badge>
            <span className="font-mono text-xs text-muted">{r.proto}</span>
            <span className="font-mono text-sm text-text">{zoneName(r.source)}</span>
            <span className="text-xs text-faint">→ {r.dest}{r.port !== 'any' ? `:${r.port}` : ''}</span>
            {r.comment && <span className="text-xs italic text-faint">“{r.comment}”</span>}
            <span className="ml-auto stat text-xs text-faint">{num(r.hits)} hits</span>
            <button onClick={() => secSend('DELETE', `/api/security/firewall/rules/${r.id}`).then(onChange)} className="text-faint hover:text-danger"><Trash2 size={14} /></button>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function Zones({ fw, onChange }: { fw: FirewallState; onChange: () => void }) {
  const [z, setZ] = useState({ name: '', cidrs: '', trust: 'internal' as FwTrust });
  async function add() {
    if (!z.name.trim()) return;
    await secSend('POST', '/api/security/firewall/zones', { name: z.name, cidrs: z.cidrs.split(',').map((c) => c.trim()).filter(Boolean), trust: z.trust });
    setZ({ name: '', cidrs: '', trust: 'internal' });
    onChange();
  }
  return (
    <Panel>
      <PanelHeader label="Zones" title="Network segmentation" hint={`${fw.zones.length} zones`} />
      <div className="grid grid-cols-2 gap-2 border-y border-line bg-[var(--bg-2)]/40 px-5 py-3 md:grid-cols-4">
        <input value={z.name} onChange={(e) => setZ({ ...z, name: e.target.value })} placeholder="zone name" className={cls} />
        <input value={z.cidrs} onChange={(e) => setZ({ ...z, cidrs: e.target.value })} placeholder="CIDRs (comma)" className={cls} />
        <select value={z.trust} onChange={(e) => setZ({ ...z, trust: e.target.value as FwTrust })} className={cls}>
          {(['trusted', 'internal', 'dmz', 'guest', 'untrusted'] as FwTrust[]).map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <button onClick={add} className="flex items-center justify-center gap-1.5 rounded-lg border border-accent/40 bg-[color-mix(in_oklch,var(--accent)_14%,transparent)] px-3 py-2 text-sm font-medium text-accent"><Plus size={14} /> Add zone</button>
      </div>
      <div className="flex flex-col">
        {fw.zones.map((zo) => (
          <div key={zo.id} className="flex flex-wrap items-center gap-3 border-b border-line/50 px-5 py-2.5 last:border-0">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: TRUST_COLOR[zo.trust] }} />
            <span className="text-sm font-medium text-text">{zo.name}</span>
            <Badge color={TRUST_COLOR[zo.trust]}>{zo.trust}</Badge>
            <span className="font-mono text-xs text-faint">{zo.cidrs.join(', ') || '—'}</span>
            <span className="ml-auto font-mono text-[0.62rem] text-faint">zone:{zo.id}</span>
            <button onClick={() => secSend('DELETE', `/api/security/firewall/zones/${zo.id}`).then(onChange)} className="text-faint hover:text-danger"><Trash2 size={14} /></button>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function ActiveResponse() {
  const { data, refresh } = useSec<ActiveResponseState>('/api/security/response', 4000);
  const SEVS: SecSeverity[] = ['high', 'critical'];
  async function set(p: { enabled?: boolean; minSeverity?: SecSeverity }) {
    await secSend('POST', '/api/security/response', p);
    refresh();
  }
  return (
    <Panel>
      <PanelHeader
        label="Active response"
        title="Auto-block attackers"
        hint="block a source automatically when a serious threat is detected"
        right={
          <label className="flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" checked={data?.enabled ?? false} onChange={(e) => set({ enabled: e.target.checked })} className="accent-[var(--accent)]" />
            <Zap size={14} className={data?.enabled ? 'text-accent' : 'text-faint'} /> {data?.enabled ? 'on' : 'off'}
          </label>
        }
      />
      <div className="flex flex-wrap items-center gap-2 px-5 pb-3 pt-2 text-xs text-muted">
        Block when severity reaches
        <select value={data?.minSeverity ?? 'critical'} onChange={(e) => set({ minSeverity: e.target.value as SecSeverity })} className="rounded-lg border border-line bg-[var(--bg-2)] px-2 py-1 text-text outline-none">
          {SEVS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <span className="text-faint">— the offending IP is added to the rules above.</span>
      </div>
      {(data?.blocked ?? []).length > 0 && (
        <div className="border-t border-line px-5 py-3">
          <div className="label mb-1.5">Auto-blocked</div>
          {(data?.blocked ?? []).slice(0, 8).map((b, i) => (
            <div key={i} className="flex items-center gap-2 py-0.5 text-xs"><span className="font-mono text-text">{b.ip}</span><span className="text-faint">— {b.reason}</span></div>
          ))}
        </div>
      )}
    </Panel>
  );
}
