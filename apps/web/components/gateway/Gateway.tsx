'use client';

import { useState } from 'react';
import { Network, ShieldAlert, Power, PowerOff, Activity, AlertTriangle, Router, Globe, Radio, ArrowRightLeft, Plus, X, Download, Check, Search } from 'lucide-react';
import type { NetworkPosture, GatewayState, PortForward, DhcpProbeResult } from '@nexrelm/types';
import { useSec, secSend, SEC_API } from '@/lib/security';
import { num } from '@/lib/format';
import { Panel, PanelHeader } from '@/components/ui/Panel';
import { Loading } from '@/components/ui/Loading';
import { StatusDot } from '@/components/ui/StatusDot';

const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV4_CIDR = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;

export function Gateway() {
  const { data, loading, refresh } = useSec<NetworkPosture>('/api/security/network', 4000);
  if (loading && !data) return <Loading label="reading network posture" />;
  if (!data) return null;
  const gw = data.gateway;
  const onPath = gw.mode !== 'off';
  const activeCount = [data.dns.active, data.dhcp.active, data.capture.active, onPath].filter(Boolean).length;

  return (
    <div className="flex flex-col gap-5">
      {/* posture overview */}
      <Panel brackets>
        <PanelHeader label="Posture" title="How Nexrelm sits on your network" hint={`${activeCount}/4 integration modes active`} right={<Network size={16} className="text-accent" />} />
        <p className="px-5 pb-3 text-xs text-faint">
          Nexrelm runs as a node on your LAN (IP <span className="stat text-accent">{data.lanIp || '—'}</span>) — no separate WAN needed. Pick how deeply to plug it in; the modes <span className="text-text">stack</span>, and each unlocks more. Use just DNS, just DHCP, just packet capture, or go all the way and route the network through it.
        </p>
        <div className="grid grid-cols-2 gap-2 px-5 pb-5 sm:grid-cols-4">
          <PostureChip label="DNS" on={data.dns.active} detail={data.dns.active ? `${data.dns.clients} clients` : 'no clients yet'} />
          <PostureChip label="DHCP" on={data.dhcp.active} detail={data.dhcp.active ? `${data.dhcp.leases} leases` : 'off'} />
          <PostureChip label="Capture" on={data.capture.active} detail={data.capture.active ? `${num(data.capture.packets)} pkts` : 'off'} />
          <PostureChip label="Gateway" on={onPath} detail={onPath ? gw.mode : 'off'} />
        </div>
      </Panel>

      <DnsMode data={data} onRefresh={refresh} />
      <DhcpMode data={data} onRefresh={refresh} />
      <CaptureMode data={data} onRefresh={refresh} />
      <GatewayMode gw={gw} available={gw.available} onRefresh={refresh} />
    </div>
  );
}

function PostureChip({ label, on, detail }: { label: string; on: boolean; detail: string }) {
  return (
    <div className={`rounded-lg border px-3 py-2 ${on ? 'border-good/40 bg-[color-mix(in_oklch,var(--good)_8%,transparent)]' : 'border-line'}`}>
      <div className="flex items-center gap-1.5 text-xs font-medium text-text"><StatusDot color={on ? 'var(--good)' : 'var(--faint)'} /> {label}</div>
      <div className="mt-0.5 stat text-[0.62rem] text-faint">{detail}</div>
    </div>
  );
}

function Unlocks({ items, color }: { items: string[]; color: string }) {
  return (
    <ul className="mt-2 flex flex-col gap-0.5">
      {items.map((i) => (
        <li key={i} className="flex items-start gap-1.5 text-[0.66rem] text-muted"><Check size={11} className="mt-0.5 shrink-0" style={{ color }} /> {i}</li>
      ))}
    </ul>
  );
}

// ── 1. DNS ──────────────────────────────────────────────────────────────────
function DnsMode({ data, onRefresh }: { data: NetworkPosture; onRefresh: () => void }) {
  const [busy, setBusy] = useState(false);
  async function handoff() {
    setBusy(true);
    try {
      await secSend('POST', '/api/security/gateway/dhcp-handoff', { enabled: !data.gateway.dhcpHandoff });
      onRefresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel>
      <PanelHeader label="Mode 1" title="DNS resolver" hint={data.dns.active ? `${data.dns.clients} clients · ${num(data.dns.queries)} queries/24h` : 'no clients resolving through Nexrelm yet'} right={<Globe size={16} className="text-accent" />} />
      <div className="grid gap-4 px-5 pb-5 pt-1 md:grid-cols-2">
        <div>
          <p className="text-xs text-muted">Point your devices' (or router DHCP's) DNS at Nexrelm. No routing needed — just resolution.</p>
          <Unlocks color="var(--accent)" items={['Ad / threat domain blocking', 'Threat-intel sinkhole', 'DGA · tunneling · NXDOMAIN detection', 'Query analytics & history']} />
        </div>
        <div className="flex flex-col gap-2">
          <div className="rounded-lg border border-line/60 px-3 py-2">
            <div className="label">Point devices here</div>
            <div className="stat mt-0.5 text-base text-accent">{data.lanIp || '—'}</div>
          </div>
          <button onClick={handoff} disabled={busy} className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium disabled:opacity-50 ${data.gateway.dhcpHandoff ? 'border-good/40 text-good' : 'border-accent/40 bg-[color-mix(in_oklch,var(--accent)_14%,transparent)] text-accent'}`}>
            <Power size={13} /> {data.gateway.dhcpHandoff ? 'Advertised via DHCP ✓' : 'Hand out via DHCP automatically'}
          </button>
          <p className="text-[0.6rem] text-faint">Makes Nexrelm's DHCP advertise itself as DNS so new leases use it — no per-device setup.</p>
        </div>
      </div>
    </Panel>
  );
}

// ── 2. DHCP ─────────────────────────────────────────────────────────────────
function DhcpMode({ data, onRefresh }: { data: NetworkPosture; onRefresh: () => void }) {
  const [busy, setBusy] = useState(false);
  async function toggle() {
    setBusy(true);
    try {
      await secSend('POST', '/api/security/network/dhcp', { enabled: !data.dhcp.active });
      onRefresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel>
      <PanelHeader
        label="Mode 2"
        title="DHCP server"
        hint={data.dhcp.active ? `serving · ${data.dhcp.leases} leases in use` : 'off — your router hands out leases'}
        right={
          <button onClick={toggle} disabled={busy} className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium disabled:opacity-50 ${data.dhcp.active ? 'border-danger/40 text-danger' : 'border-accent/40 bg-[color-mix(in_oklch,var(--accent)_14%,transparent)] text-accent'}`}>
            {data.dhcp.active ? <PowerOff size={13} /> : <Power size={13} />} {data.dhcp.active ? 'Stop' : 'Serve DHCP'}
          </button>
        }
      />
      <div className="px-5 pb-5 pt-1">
        <p className="text-xs text-muted">Let Nexrelm hand out leases. Only run this if your router's DHCP is off — two DHCP servers race and clients keep unicast-renewing with whichever one they already have, so they won't switch to Nexrelm until the old one is off. Configure scopes in the <span className="text-text">DHCP</span> module.</p>
        <Unlocks color="var(--violet)" items={['Lease management & history', 'Authoritative device inventory', 'New-device detection from leases', 'Advertise Nexrelm as DNS + gateway']} />
        <DhcpProbe />
      </div>
    </Panel>
  );
}

function DhcpProbe() {
  const { data, refresh } = useSec<DhcpProbeResult | null>('/api/dhcp/probe', 0);
  const [busy, setBusy] = useState(false);
  async function scan() {
    setBusy(true);
    try {
      await secSend('POST', '/api/dhcp/probe');
      refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mt-3 rounded-lg border border-line/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="label">Who's serving DHCP? (active probe)</span>
        <button onClick={scan} disabled={busy} className="flex items-center gap-1.5 rounded-lg border border-accent/40 bg-[color-mix(in_oklch,var(--accent)_14%,transparent)] px-2.5 py-1 text-xs font-medium text-accent disabled:opacity-50"><Search size={12} className={busy ? 'animate-pulse' : ''} /> {busy ? 'Probing…' : 'Scan'}</button>
      </div>
      <p className="mt-1 text-[0.6rem] text-faint">Broadcasts a DHCP discovery and counts who answers — the reliable way to spot a rogue server (passive sniffing misses unicast DHCP). Read-only, takes no lease.</p>
      {data && (
        <div className="mt-2">
          {data.rogue && <div className="mb-1.5 rounded border border-danger/40 bg-[color-mix(in_oklch,var(--danger)_10%,transparent)] px-2 py-1 text-[0.66rem] text-danger">⚠ {data.servers.length} DHCP servers answered — a rogue is present. Only one should serve a LAN.</div>}
          {data.servers.length === 0 && <p className="text-[0.66rem] text-faint">Sent a DHCP discovery — <span className="text-muted">no server answered</span>. Either there's no DHCP server reachable on this segment, or the network refuses unknown devices a lease (802.1X / NAC / DHCP-snooping — common on a managed Windows domain). The same protection is likely why a second DHCP server here can't win clients.</p>}
          {data.servers.map((s) => (
            <div key={s.server} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 border-b border-line/40 py-1 stat text-[0.66rem] last:border-0">
              <span className={data.rogue ? 'text-danger' : 'text-text'}>{s.server}</span>
              <span className="text-faint">offers {s.offered}</span>
              {s.router && <span className="text-faint">gw {s.router}</span>}
              {s.dns && <span className="text-faint">dns {s.dns}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── 3. Capture ──────────────────────────────────────────────────────────────
function CaptureMode({ data, onRefresh }: { data: NetworkPosture; onRefresh: () => void }) {
  const [busy, setBusy] = useState(false);
  async function toggle() {
    setBusy(true);
    try {
      await secSend('POST', '/api/security/sniffer', { action: data.capture.active ? 'stop' : 'start' });
      onRefresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel>
      <PanelHeader
        label="Mode 3"
        title="Passive capture"
        hint={data.capture.active ? `capturing on ${data.capture.iface} · ${num(data.capture.packets)} packets` : 'off'}
        right={
          <button onClick={toggle} disabled={busy} className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium disabled:opacity-50 ${data.capture.active ? 'border-danger/40 text-danger' : 'border-accent/40 bg-[color-mix(in_oklch,var(--accent)_14%,transparent)] text-accent'}`}>
            <Radio size={13} className={data.capture.active ? 'animate-pulse' : ''} /> {data.capture.active ? 'Stop' : 'Start capture'}
          </button>
        }
      />
      <div className="px-5 pb-5 pt-1">
        <p className="text-xs text-muted">Read packets straight off the wire. On a switched LAN this sees broadcast + this host; for full visibility give Nexrelm a switch <span className="text-text">mirror/SPAN port</span> — or use the gateway mode below.</p>
        <Unlocks color="var(--danger)" items={['Port scan · sweep · lateral movement', 'ARP spoof · rogue DHCP · LLMNR poisoning', 'Live traffic graph · talkers · flows', 'Known-bad IP contact on the wire']} />
      </div>
    </Panel>
  );
}

// ── 4. Gateway (the powerful one) ─────────────────────────────────────────────
function GatewayMode({ gw, available, onRefresh }: { gw: GatewayState; available: boolean; onRefresh: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const onPath = gw.mode !== 'off';
  async function act(body: Record<string, unknown>) {
    setBusy(true);
    setErr(null);
    try {
      await secSend('POST', '/api/security/gateway', body);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'gateway action failed');
    } finally {
      setBusy(false);
      onRefresh();
    }
  }
  return (
    <Panel scanlines>
      <PanelHeader
        label="Mode 4"
        title="Be the gateway (on the path)"
        hint={onPath ? `ACTIVE · ${gw.mode === 'lan' ? gw.lanSubnet : gw.client} → ${gw.wan}` : available ? 'route traffic through Nexrelm' : 'root helper not installed'}
        right={onPath ? <span className="flex items-center gap-1.5 text-xs text-danger"><Activity size={13} /> routing</span> : <ArrowRightLeft size={16} className="text-accent" />}
      />
      <div className="px-5 pb-3 pt-1">
        <p className="text-xs text-muted">Route + NAT traffic through Nexrelm so it sees and can act on <span className="text-text">everything</span> — the only mode that gives full network-wide visibility without a mirror port, plus enforcement. OFF by default; kill switch + dead-man watchdog.</p>
        <Unlocks color="var(--accent)" items={['All of modes 1–3, network-wide, automatically', 'Every device’s full traffic (Wireshark-style)', 'Inline blocking / quarantine', 'Port forwarding (DNAT)']} />
      </div>

      {!available && (
        <div className="mx-5 mb-3 flex items-start gap-2 rounded-lg border border-line bg-[var(--bg-1)] p-3 text-xs text-muted">
          <AlertTriangle size={14} className="mt-0.5 text-warn" />
          <div>
            <div className="text-text">Root helper not installed — one-time setup.</div>
            <pre className="mt-1.5 overflow-x-auto rounded border border-line bg-[var(--bg-0)] p-2 stat text-[0.68rem] text-faint">sudo bash deploy/install-gateway.sh</pre>
            {gw.helperStatus && <div className="mt-1 break-all stat text-[0.66rem] text-faint">helper: {gw.helperStatus}</div>}
          </div>
        </div>
      )}

      {onPath ? (
        <div className="mx-5 mb-4 flex items-center justify-between gap-3 rounded-lg border border-danger/40 bg-[color-mix(in_oklch,var(--danger)_10%,transparent)] px-4 py-3">
          <span className="text-sm text-text">Routing <span className="stat text-danger">{gw.mode === 'lan' ? gw.lanSubnet : gw.client}</span> through Nexrelm</span>
          <button onClick={() => act({ action: 'disable' })} disabled={busy} className="flex items-center gap-1.5 rounded-lg border border-danger/60 bg-[color-mix(in_oklch,var(--danger)_18%,transparent)] px-3 py-1.5 text-xs font-semibold text-danger disabled:opacity-50"><PowerOff size={13} /> Kill switch</button>
        </div>
      ) : (
        <div className="mx-5 mb-4 grid gap-3 md:grid-cols-2">
          <LanForm gw={gw} disabled={!available || busy} onEnable={(subnet) => act({ action: 'lan', subnet })} />
          <DeviceForm gw={gw} disabled={!available || busy} onEnable={(client) => act({ action: 'device', client })} />
        </div>
      )}
      {err && <div className="mx-5 mb-4 text-xs text-danger">{err}</div>}

      <PortForwards gw={gw} onRefresh={onRefresh} />
    </Panel>
  );
}

function LanForm({ gw, disabled, onEnable }: { gw: GatewayState; disabled: boolean; onEnable: (subnet: string) => void }) {
  const [subnet, setSubnet] = useState('');
  const valid = subnet === '' || IPV4_CIDR.test(subnet);
  const hint = IPV4.test(gw.lanIp) ? `${gw.lanIp.split('.').slice(0, 3).join('.')}.0/24` : '192.168.1.0/24';
  return (
    <div className="rounded-lg border border-line p-3">
      <div className="flex items-center gap-1.5 text-xs font-medium text-text"><Globe size={13} className="text-accent" /> Whole LAN</div>
      <input value={subnet} onChange={(e) => setSubnet(e.target.value)} placeholder={`auto: ${hint}`} disabled={disabled} className="mt-2 w-full rounded border border-line bg-[var(--bg-0)] px-2 py-1.5 stat text-xs text-text outline-none placeholder:text-faint focus:border-accent disabled:opacity-40" />
      <button onClick={() => onEnable(subnet.trim())} disabled={disabled || !valid} className="mt-2 w-full rounded border border-accent/50 bg-[color-mix(in_oklch,var(--accent)_14%,transparent)] px-3 py-1.5 text-xs font-medium text-accent disabled:opacity-40">Become the gateway</button>
    </div>
  );
}
function DeviceForm({ gw, disabled, onEnable }: { gw: GatewayState; disabled: boolean; onEnable: (client: string) => void }) {
  const [client, setClient] = useState('');
  const valid = client !== '' && IPV4.test(client.split('/')[0] ?? '');
  return (
    <div className="rounded-lg border border-line p-3">
      <div className="flex items-center gap-1.5 text-xs font-medium text-text"><Router size={13} className="text-violet" /> One device (pilot)</div>
      <input value={client} onChange={(e) => setClient(e.target.value)} placeholder="192.168.1.42" disabled={disabled} className="mt-2 w-full rounded border border-line bg-[var(--bg-0)] px-2 py-1.5 stat text-xs text-text outline-none placeholder:text-faint focus:border-accent disabled:opacity-40" />
      <button onClick={() => onEnable(client.trim())} disabled={disabled || !valid} className="mt-2 w-full rounded border border-violet/50 bg-[color-mix(in_oklch,var(--violet)_14%,transparent)] px-3 py-1.5 text-xs font-medium text-violet disabled:opacity-40">Pilot this device</button>
    </div>
  );
}

function PortForwards({ gw, onRefresh }: { gw: GatewayState; onRefresh: () => void }) {
  const [proto, setProto] = useState<'tcp' | 'udp'>('tcp');
  const [wanPort, setWanPort] = useState('');
  const [toHost, setToHost] = useState('');
  const [toPort, setToPort] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const valid = /^\d+$/.test(wanPort) && /^\d+$/.test(toPort) && IPV4.test(toHost);

  async function add() {
    setErr(null);
    try {
      await secSend('POST', '/api/security/gateway/forwards', { proto, wanPort: Number(wanPort), toHost, toPort: Number(toPort) });
      setWanPort('');
      setToHost('');
      setToPort('');
      onRefresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'invalid forward');
    }
  }
  async function del(id: string) {
    await secSend('DELETE', `/api/security/gateway/forwards/${id}`);
    onRefresh();
  }

  return (
    <div className="border-t border-line">
      <div className="flex items-center justify-between px-5 pt-3">
        <span className="label">Port forwarding (DNAT) · {gw.forwards.length}</span>
        <a href={`${SEC_API}/api/security/gateway/forwards/export`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[0.66rem] text-muted hover:text-text"><Download size={12} /> Export nft</a>
      </div>
      {gw.forwards.map((f: PortForward) => (
        <div key={f.id} className="flex items-center gap-3 px-5 py-2 text-xs">
          <ArrowRightLeft size={12} className="shrink-0 text-accent" />
          <span className="stat min-w-0 flex-1 text-text">{gw.wan || 'wan'}:{f.wanPort}/{f.proto} <span className="text-faint">→</span> {f.toHost}:{f.toPort}</span>
          <button onClick={() => del(f.id)} className="text-faint hover:text-danger"><X size={12} /></button>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2 px-5 py-3">
        <select value={proto} onChange={(e) => setProto(e.target.value as 'tcp' | 'udp')} className="rounded border border-line bg-[var(--bg-0)] px-2 py-1.5 text-xs text-text outline-none"><option>tcp</option><option>udp</option></select>
        <input value={wanPort} onChange={(e) => setWanPort(e.target.value)} placeholder="WAN port" className="w-24 rounded border border-line bg-[var(--bg-0)] px-2 py-1.5 stat text-xs text-text outline-none focus:border-accent" />
        <span className="text-faint">→</span>
        <input value={toHost} onChange={(e) => setToHost(e.target.value)} placeholder="192.168.1.50" className="w-32 rounded border border-line bg-[var(--bg-0)] px-2 py-1.5 stat text-xs text-text outline-none focus:border-accent" />
        <input value={toPort} onChange={(e) => setToPort(e.target.value)} placeholder="port" className="w-16 rounded border border-line bg-[var(--bg-0)] px-2 py-1.5 stat text-xs text-text outline-none focus:border-accent" />
        <button onClick={add} disabled={!valid} className="flex items-center gap-1 rounded border border-accent/40 bg-[color-mix(in_oklch,var(--accent)_14%,transparent)] px-3 py-1.5 text-xs font-medium text-accent disabled:opacity-40"><Plus size={12} /> Add</button>
        {err && <span className="text-xs text-danger">{err}</span>}
      </div>
    </div>
  );
}
