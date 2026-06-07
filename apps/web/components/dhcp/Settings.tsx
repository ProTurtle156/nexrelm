'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Check, Globe } from 'lucide-react';
import type { DhcpServerSettings } from '@nexrelm/types';
import { dhcpSend, useDhcp } from '@/lib/dhcp';
import { cn } from '@/lib/format';
import { Panel, PanelHeader } from '@/components/ui/Panel';
import { Loading } from '@/components/ui/Loading';

const cls = 'rounded-lg border border-line bg-[var(--bg-2)] px-3 py-1.5 font-mono text-sm text-text outline-none placeholder:text-faint focus:border-accent/50';

function Toggle({ on, onChange, label, hint }: { on: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 py-1">
      <button type="button" onClick={() => onChange(!on)} className={cn('relative mt-0.5 h-5 w-9 shrink-0 rounded-full border transition-colors', on ? 'border-accent/50 bg-[color-mix(in_oklch,var(--accent)_35%,transparent)]' : 'border-line bg-[var(--bg-2)]')}>
        <span className={cn('absolute top-0.5 h-3.5 w-3.5 rounded-full bg-text transition-all', on ? 'left-[18px]' : 'left-0.5')} />
      </button>
      <span><span className="text-sm text-text">{label}</span>{hint && <span className="block text-xs text-faint">{hint}</span>}</span>
    </label>
  );
}
function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 py-1">
      <span className="w-44"><span className="block text-sm text-text">{label}</span>{hint && <span className="block text-xs text-faint">{hint}</span>}</span>
      {children}
    </div>
  );
}
function Section({ title, desc, children }: { title: string; desc?: string; children: ReactNode }) {
  return (
    <Panel>
      <PanelHeader label="Settings" title={title} hint={desc} />
      <div className="flex flex-col gap-2 px-5 pb-5 pt-3">{children}</div>
    </Panel>
  );
}

export function Settings() {
  const { data: loaded, loading, refresh } = useDhcp<DhcpServerSettings>('/api/dhcp/settings', 0);
  const [d, setD] = useState<DhcpServerSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => { if (loaded && !d) setD(loaded); }, [loaded, d]);
  if (loading || !d) return <Loading label="loading settings" />;
  const set = <K extends keyof DhcpServerSettings>(k: K, v: DhcpServerSettings[K]) => { setD({ ...d, [k]: v }); setSaved(false); };

  async function save() {
    if (!d) return;
    setSaving(true);
    try { await dhcpSend('PATCH', '/api/dhcp/settings', d); setSaved(true); refresh(); } finally { setSaving(false); }
  }

  return (
    <div className="flex flex-col gap-5 pb-16">
      {/* DNS — the headline option */}
      <Panel brackets>
        <PanelHeader label="DNS" title="What DNS do clients get?" hint="option 006 handed out in every lease" right={<Globe size={16} className="text-accent" />} />
        <div className="flex flex-col gap-3 px-5 pb-5 pt-3">
          <Toggle
            on={d.useOwnDns}
            onChange={(v) => set('useOwnDns', v)}
            label="Use Nexrelm's own DNS resolver"
            hint={`hand out ${d.serverIp} as the DNS server → every device is filtered + logged by Nexrelm (recommended)`}
          />
          {!d.useOwnDns && (
            <Row label="Custom DNS servers" hint="one or more, comma-separated">
              <input value={d.customDns.join(', ')} onChange={(e) => set('customDns', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))} placeholder="1.1.1.1, 1.0.0.1" className={cls + ' w-72'} />
            </Row>
          )}
          <Row label="DNS domain name" hint="option 015"><input value={d.domainName} onChange={(e) => set('domainName', e.target.value)} placeholder="lan" className={cls + ' w-44'} /></Row>
        </div>
      </Panel>

      <Section title="Server binding" desc="which address/interface the server answers on">
        <Row label="Server IP" hint="option 054 / siaddr"><input value={d.serverIp} onChange={(e) => set('serverIp', e.target.value)} placeholder="192.168.1.177" className={cls + ' w-44'} /></Row>
        <Row label="Interface" hint="optional"><input value={d.iface} onChange={(e) => set('iface', e.target.value)} placeholder="wlp0s20f3" className={cls + ' w-44'} /></Row>
        <Row label="UDP port"><input type="number" value={d.port} onChange={(e) => set('port', Number(e.target.value))} className={cls + ' w-24'} /></Row>
      </Section>

      <Section title="Behavior">
        <Toggle on={d.authoritative} onChange={(v) => set('authoritative', v)} label="Authoritative" hint="send DHCPNAK for requests outside our scopes (speeds up wrong-network clients)" />
        <Toggle on={d.ddnsUpdate} onChange={(v) => set('ddnsUpdate', v)} label="Dynamic DNS updates" hint="register leased hostnames as A/PTR records in the Nexrelm resolver" />
        <Row label="Conflict detection" hint="ping attempts before offering an address (0 = off)">
          <input type="number" value={d.conflictDetectionAttempts} onChange={(e) => set('conflictDetectionAttempts', Number(e.target.value))} className={cls + ' w-20'} />
        </Row>
      </Section>

      <div className="sticky bottom-4 z-20 flex justify-end">
        <button onClick={save} disabled={saving} className="flex items-center gap-2 rounded-xl border border-accent/50 bg-[var(--bg-2)] px-6 py-2.5 text-sm font-medium text-accent shadow-glow backdrop-blur disabled:opacity-50">
          {saved && <Check size={15} />} {saving ? 'saving…' : saved ? 'Saved' : 'Save settings'}
        </button>
      </div>
    </div>
  );
}
