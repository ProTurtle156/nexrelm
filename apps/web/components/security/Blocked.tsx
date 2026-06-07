'use client';

import { Ban, Shield, Globe, MonitorSmartphone, Undo2 } from 'lucide-react';
import type { BlockedState } from '@nexrelm/types';
import { useSec, secSend } from '@/lib/security';
import { num } from '@/lib/format';
import { Panel, PanelHeader } from '@/components/ui/Panel';
import { Loading } from '@/components/ui/Loading';

export function Blocked() {
  const { data, loading, refresh } = useSec<BlockedState>('/api/security/blocked', 5000);
  if (loading && !data) return <Loading label="loading blocks" />;
  if (!data) return null;

  async function unblock(kind: 'firewall' | 'domain' | 'device', id: string) {
    await secSend('POST', '/api/security/blocked/unblock', { kind, id });
    refresh();
  }

  const total = data.firewall.length + data.domains.length + data.devices.length;

  return (
    <div className="flex flex-col gap-5">
      <Panel brackets>
        <PanelHeader label="Blocked" title="What Nexrelm is blocking" hint={`${total} active block${total === 1 ? '' : 's'}`} right={<Ban size={16} className="text-danger" />} />
        <p className="px-5 pb-4 text-xs text-faint">
          Everything Nexrelm is actively blocking — firewall drops, DNS-level domain blocks, and quarantined devices. Review anything here and <span className="text-text">undo it</span> with one click. (The threat-intel DNS sinkhole is feed-driven and toggled in Threats → Sinkhole, not listed individually.)
        </p>
      </Panel>

      <Panel>
        <PanelHeader label="Firewall" title="Blocked sources" hint={`${data.firewall.length} deny/drop rule${data.firewall.length === 1 ? '' : 's'}`} right={<Shield size={16} className="text-accent" />} />
        <div className="flex flex-col">
          {data.firewall.length === 0 && <Empty text="No firewall block rules. Blocks added by remediation or active-response appear here." />}
          {data.firewall.map((r) => (
            <Row key={r.id} title={r.source} sub={`${r.direction} · ${r.action}${r.proto && r.proto !== 'any' ? ` · ${r.proto}/${r.port}` : ''}`} note={r.comment} hits={r.hits} onUndo={() => unblock('firewall', r.id)} />
          ))}
        </div>
      </Panel>

      <Panel>
        <PanelHeader label="DNS" title="Blocked domains" hint={`${data.domains.length} domain${data.domains.length === 1 ? '' : 's'}`} right={<Globe size={16} className="text-accent" />} />
        <div className="flex flex-col">
          {data.domains.length === 0 && <Empty text="No DNS-level domain blocks. Domains blocked via remediation appear here." />}
          {data.domains.map((d) => (
            <Row key={d.id} title={d.domain} sub="DNS block · returns 0.0.0.0 / NXDOMAIN" note={d.comment} hits={d.hits} onUndo={() => unblock('domain', String(d.id))} />
          ))}
        </div>
      </Panel>

      <Panel>
        <PanelHeader label="Devices" title="Blocked devices" hint={`${data.devices.length} device${data.devices.length === 1 ? '' : 's'}`} right={<MonitorSmartphone size={16} className="text-accent" />} />
        <div className="flex flex-col">
          {data.devices.length === 0 && <Empty text="No blocked devices. Block a device in the Devices tab to quarantine it." />}
          {data.devices.map((dev) => (
            <Row key={dev.mac} title={dev.name || dev.ip || dev.mac} sub={`${dev.ip} · ${dev.mac}${dev.vendor ? ` · ${dev.vendor}` : ''}`} onUndo={() => unblock('device', dev.mac)} undoLabel="Approve" />
          ))}
        </div>
      </Panel>
    </div>
  );
}

function Row({ title, sub, note, hits, onUndo, undoLabel = 'Unblock' }: { title: string; sub: string; note?: string; hits?: number; onUndo: () => void; undoLabel?: string }) {
  return (
    <div className="flex items-center gap-3 border-b border-line/50 px-5 py-3 last:border-0">
      <Ban size={13} className="shrink-0 text-danger" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="stat truncate text-sm text-text">{title}</span>
          {typeof hits === 'number' && hits > 0 && <span className="rounded-full border border-line px-1.5 py-0.5 text-[0.58rem] text-muted">{num(hits)} hits</span>}
        </div>
        <div className="mt-0.5 stat text-[0.66rem] text-faint">{sub}{note ? ` · ${note}` : ''}</div>
      </div>
      <button onClick={onUndo} className="flex shrink-0 items-center gap-1.5 rounded-lg border border-good/40 px-3 py-1.5 text-xs font-medium text-good hover:bg-[color-mix(in_oklch,var(--good)_12%,transparent)]">
        <Undo2 size={13} /> {undoLabel}
      </button>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="px-5 py-8 text-center text-sm text-faint">{text}</p>;
}
