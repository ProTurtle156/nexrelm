'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import type { CondForwardRule, DnsResolverSettings, ListenMode, UpstreamPreset } from '@nexrelm/types';
import { dnsSend, useDns } from '@/lib/dns';
import { cn } from '@/lib/format';
import { Panel, PanelHeader } from '@/components/ui/Panel';
import { Loading } from '@/components/ui/Loading';

// ── tiny form primitives ──────────────────────────────────────────────────────────
function Toggle({ on, onChange, label, hint }: { on: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 py-1.5">
      <button
        type="button"
        onClick={() => onChange(!on)}
        className={cn('relative mt-0.5 h-5 w-9 shrink-0 rounded-full border transition-colors', on ? 'border-accent/50 bg-[color-mix(in_oklch,var(--accent)_35%,transparent)]' : 'border-line bg-[var(--bg-2)]')}
      >
        <span className={cn('absolute top-0.5 h-3.5 w-3.5 rounded-full bg-text transition-all', on ? 'left-[18px]' : 'left-0.5')} />
      </button>
      <span className="min-w-0">
        <span className="text-sm text-text">{label}</span>
        {hint && <span className="block text-xs text-faint">{hint}</span>}
      </span>
    </label>
  );
}
function Num({ value, onChange, w = 'w-24' }: { value: number; onChange: (v: number) => void; w?: string }) {
  return (
    <input
      type="number"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className={cn('rounded-lg border border-line bg-[var(--bg-2)] px-3 py-1.5 stat text-sm text-text outline-none focus:border-accent/50', w)}
    />
  );
}
function Text({ value, onChange, placeholder, w = 'w-full' }: { value: string; onChange: (v: string) => void; placeholder?: string; w?: string }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={cn('rounded-lg border border-line bg-[var(--bg-2)] px-3 py-1.5 font-mono text-sm text-text outline-none placeholder:text-faint focus:border-accent/50', w)}
    />
  );
}
function Section({ title, children, desc }: { title: string; desc?: string; children: ReactNode }) {
  return (
    <Panel>
      <PanelHeader label="Settings" title={title} hint={desc} />
      <div className="flex flex-col gap-2 px-5 pb-5 pt-3">{children}</div>
    </Panel>
  );
}
const Trait = ({ on, children }: { on: boolean; children: ReactNode }) => (
  <span className={cn('rounded px-1.5 py-0.5 text-[0.6rem] font-medium uppercase tracking-wide', on ? 'text-good' : 'text-faint')} style={{ background: on ? 'color-mix(in oklch, var(--good) 12%, transparent)' : 'transparent' }}>
    {children}
  </span>
);

export function Settings() {
  const { data: loaded, loading } = useDns<DnsResolverSettings>('/api/dns/settings', 0);
  const { data: presets } = useDns<UpstreamPreset[]>('/api/dns/upstreams', 0);
  const [d, setD] = useState<DnsResolverSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (loaded && !d) setD(loaded);
  }, [loaded, d]);

  if (loading || !d) return <Loading label="loading settings" />;
  const set = <K extends keyof DnsResolverSettings>(k: K, v: DnsResolverSettings[K]) => {
    setD({ ...d, [k]: v });
    setSaved(false);
  };

  const presetOn = (p: UpstreamPreset) => p.ipv4.every((ip) => d.upstreams.includes(ip));
  const togglePreset = (p: UpstreamPreset) => {
    const has = presetOn(p);
    const next = has ? d.upstreams.filter((ip) => !p.ipv4.includes(ip)) : [...new Set([...d.upstreams, ...p.ipv4])];
    set('upstreams', next);
  };

  async function save() {
    if (!d) return;
    setSaving(true);
    try {
      await dnsSend('PATCH', '/api/dns/settings', d);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  const LISTEN: Array<{ v: ListenMode; label: string; hint: string; danger?: boolean }> = [
    { v: 'local', label: 'Allow only local requests', hint: 'queries only from devices one hop away (recommended)' },
    { v: 'single', label: 'Respond only on interface', hint: 'answer only on the bound interface' },
    { v: 'bind', label: 'Bind only to interface', hint: 'bind the single interface', danger: true },
    { v: 'all', label: 'Permit all origins', hint: 'answer any client — only safe behind a firewall', danger: true },
  ];

  return (
    <div className="flex flex-col gap-5 pb-16">
      {/* Upstreams */}
      <Section title="Upstream DNS Servers" desc="where queries are forwarded — select presets or add custom servers below">
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {(presets ?? []).map((p) => {
            const on = presetOn(p);
            return (
              <button
                key={p.id}
                onClick={() => togglePreset(p)}
                className={cn('flex items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors', on ? 'border-accent/40 bg-[color-mix(in_oklch,var(--accent)_10%,transparent)]' : 'border-line hover:border-line-strong')}
              >
                <span className={cn('grid h-4 w-4 shrink-0 place-items-center rounded border', on ? 'border-accent bg-accent text-[var(--bg)]' : 'border-line')}>
                  {on && <Check size={11} strokeWidth={3} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-text">{p.name}</span>
                  <span className="block font-mono text-[0.66rem] text-faint">{p.ipv4.join(', ')}</span>
                </span>
                <span className="flex shrink-0 gap-1">
                  <Trait on={p.ecs}>ECS</Trait>
                  <Trait on={p.dnssec}>DNSSEC</Trait>
                </span>
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-faint">
          ECS sends partial client IP to upstreams for geo-accurate answers (reduces privacy).
        </p>
        <Toggle on={d.ecs} onChange={(v) => set('ecs', v)} label="Enable EDNS Client Subnet (ECS)" />

        <div className="mt-3">
          <div className="label mb-1">Custom DNS servers</div>
          <p className="mb-2 text-xs text-faint">One server per line as <code className="font-mono text-accent">IP#port</code> (port optional, defaults to 53). This is the full active upstream list.</p>
          <textarea
            value={d.upstreams.join('\n')}
            onChange={(e) => set('upstreams', e.target.value.split('\n').map((s) => s.trim()).filter(Boolean))}
            rows={4}
            className="w-full rounded-lg border border-line bg-[var(--bg-2)] px-3 py-2 font-mono text-sm text-text outline-none focus:border-accent/50"
          />
        </div>
      </Section>

      {/* Domain */}
      <Section title="DNS domain settings" desc="your local domain — answered locally, never forwarded">
        <div className="flex items-center gap-3">
          <span className="label w-28">Domain</span>
          <Text value={d.localDomain} onChange={(v) => set('localDomain', v)} placeholder="lan" w="w-48" />
        </div>
        <Toggle on={d.expandHostnames} onChange={(v) => set('expandHostnames', v)} label="Expand hostnames" hint="add the domain to simple names without a period" />
      </Section>

      {/* Rate limiting */}
      <Section title="Rate-limiting" desc="REFUSE clients that exceed the limit (per client). Set both to 0 to disable.">
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
          Block clients making more than <Num value={d.rateLimitCount} onChange={(v) => set('rateLimitCount', v)} /> queries within{' '}
          <Num value={d.rateLimitWindow} onChange={(v) => set('rateLimitWindow', v)} /> seconds.
        </div>
      </Section>

      {/* Interface */}
      <Section title="Interface settings" desc="which clients the resolver answers">
        <div className="flex flex-col gap-1">
          {LISTEN.map((m) => (
            <label key={m.v} className="flex cursor-pointer items-start gap-3 py-1">
              <input type="radio" checked={d.listenMode === m.v} onChange={() => set('listenMode', m.v)} className="mt-1 accent-[var(--accent)]" />
              <span>
                <span className={cn('text-sm', m.danger ? 'text-warn' : 'text-text')}>{m.label}</span>
                <span className="block text-xs text-faint">{m.hint}</span>
              </span>
            </label>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <span className="label w-28">Bind address</span>
          <Text value={d.bindAddress} onChange={(v) => set('bindAddress', v)} placeholder="192.168.1.177" w="w-44" />
          <span className="label">Port</span>
          <Num value={d.port} onChange={(v) => set('port', v)} w="w-20" />
          <span className="label">Iface</span>
          <Text value={d.iface} onChange={(v) => set('iface', v)} placeholder="eth0" w="w-28" />
        </div>
      </Section>

      {/* Advanced */}
      <Section title="Advanced DNS settings">
        <Toggle on={d.neverForwardNonFqdn} onChange={(v) => set('neverForwardNonFqdn', v)} label="Never forward non-FQDN queries" hint="plain names without a dot are answered locally or NXDOMAIN" />
        <Toggle on={d.neverForwardReversePrivate} onChange={(v) => set('neverForwardReversePrivate', v)} label="Never forward reverse lookups for private ranges" hint="RFC6303 private reverse lookups answered locally" />
        <Toggle on={d.dnssec} onChange={(v) => set('dnssec', v)} label="Use DNSSEC" hint="request DNSSEC records when forwarding (use a DNSSEC upstream)" />
      </Section>

      {/* Conditional forwarding */}
      <CondForwarding rules={d.condForwarding} onChange={(r) => set('condForwarding', r)} />

      {/* Privacy */}
      <Section title="Privacy & logging">
        <Toggle on={d.logQueries} onChange={(v) => set('logQueries', v)} label="Log DNS queries and replies" hint="powers the query log + statistics" />
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <span className="label w-44">Keep queries (days)</span>
          <Num value={d.dbMaxDays} onChange={(v) => set('dbMaxDays', v)} />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="label w-44">Keep client addresses (days)</span>
          <Num value={d.ipMaxDays} onChange={(v) => set('ipMaxDays', v)} />
        </div>
        <div className="mt-2 label">Query anonymization (privacy level)</div>
        <div className="flex flex-col gap-1">
          {[
            ['Show everything', 'maximum statistics'],
            ['Hide domains', 'disables top-domain tables'],
            ['Hide domains and clients', 'disables all dashboard tables'],
            ['Anonymous mode', 'no history saved at all'],
          ].map(([label, hint], i) => (
            <label key={i} className="flex cursor-pointer items-start gap-3 py-1">
              <input type="radio" checked={d.privacyLevel === i} onChange={() => set('privacyLevel', i as 0 | 1 | 2 | 3)} className="mt-1 accent-[var(--accent)]" />
              <span>
                <span className="text-sm text-text">{label}</span>
                <span className="block text-xs text-faint">{hint}</span>
              </span>
            </label>
          ))}
        </div>
      </Section>

      {/* sticky save */}
      <div className="sticky bottom-4 z-20 flex justify-end">
        <button
          onClick={save}
          disabled={saving}
          className="flex items-center gap-2 rounded-xl border border-accent/50 bg-[var(--bg-2)] px-6 py-2.5 text-sm font-medium text-accent shadow-glow backdrop-blur disabled:opacity-50"
        >
          {saved ? <Check size={15} /> : null}
          {saving ? 'saving…' : saved ? 'Saved — resolver updated' : 'Save settings'}
        </button>
      </div>
    </div>
  );
}

// ── conditional forwarding (simplified, Pi-hole style) ───────────────────────────────
function CondForwarding({ rules, onChange }: { rules: CondForwardRule[]; onChange: (r: CondForwardRule[]) => void }) {
  const r0 = rules[0] ?? { enabled: false, cidr: '', target: '', domain: '' };
  const on = !!rules[0]?.enabled;
  const patch = (p: Partial<CondForwardRule>) => onChange([{ ...r0, enabled: true, ...p }]);
  const row = (label: string, hint: string, node: ReactNode) => (
    <div className="flex flex-wrap items-center gap-3 py-1">
      <span className="w-52">
        <span className="block text-sm text-text">{label}</span>
        <span className="block text-xs text-faint">{hint}</span>
      </span>
      {node}
    </div>
  );
  return (
    <Section title="Conditional forwarding" desc="resolve your devices' names by forwarding local reverse lookups to your router">
      <Toggle
        on={on}
        onChange={(v) => onChange(v ? [{ ...r0, enabled: true }] : [])}
        label="Enable conditional forwarding"
        hint="needed so Top Clients show device names instead of bare IPs (when Nexrelm isn't your DHCP server)"
      />
      {on && (
        <div className="mt-2 flex flex-col gap-1 border-l border-line pl-4">
          {row('Local network (CIDR)', 'e.g. your LAN range', <Text value={r0.cidr} onChange={(v) => patch({ cidr: v })} placeholder="192.168.1.0/24" w="w-52" />)}
          {row('Router / DHCP server IP', 'where device names live', <Text value={r0.target} onChange={(v) => patch({ target: v })} placeholder="192.168.1.99" w="w-52" />)}
          {row('Local domain name', 'optional, e.g. lan / fritz.box', <Text value={r0.domain ?? ''} onChange={(v) => patch({ domain: v })} placeholder="lan" w="w-44" />)}
        </div>
      )}
    </Section>
  );
}
