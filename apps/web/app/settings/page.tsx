'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Database, Eraser, Globe, KeyRound, LogOut, Network, Radio, Rocket, Router, Save, Server, ShieldHalf, Terminal, UsersRound, type LucideIcon } from 'lucide-react';
import type {
  AuthMe,
  DhcpServerStats,
  DhcpServerStatus,
  DirectoryStatus,
  DnsResolverStats,
  NetworkPosture,
  SecurityOverview,
  SystemInfo,
  SystemPruneResult,
  SystemSettings,
  Topology,
} from '@nexrelm/types';
import { useNexrelm } from '@/components/providers/NexrelmProvider';
import { dnsSend, useDns } from '@/lib/dns';
import { clearToken } from '@/lib/auth';
import { cn, num } from '@/lib/format';
import { ThemePicker } from '@/components/settings/ThemePicker';
import { Panel, PanelHeader } from '@/components/ui/Panel';
import { Badge } from '@/components/ui/Badge';
import { StatusDot } from '@/components/ui/StatusDot';
import { CONFIGURED_MODE } from '@/lib/api';

interface Health {
  status: string;
  service: string;
  version: string;
  uptimeSec: number;
}

const fmtUptime = (s?: number): string => {
  if (s == null) return '—';
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m ${Math.floor(s % 60)}s`;
};

/** Real system hub: live control-plane health, true module state with links to
 *  where each module's settings actually live, storage layout and operations. */
export default function SettingsPage() {
  const { mode, status } = useNexrelm();
  const { data: health } = useDns<Health>('/api/health', 5000);
  const { data: dns } = useDns<DnsResolverStats>('/api/dns/stats', 15000);
  const { data: dhcpStatus } = useDns<DhcpServerStatus>('/api/dhcp/status', 15000);
  const { data: dhcp } = useDns<DhcpServerStats>('/api/dhcp/stats', 15000);
  const { data: dirStatus } = useDns<DirectoryStatus>('/api/directory/status', 15000);
  const { data: sec } = useDns<SecurityOverview>('/api/security/overview', 15000);
  const { data: posture } = useDns<NetworkPosture>('/api/security/network', 15000);
  const { data: topology } = useDns<Topology>('/api/topology', 30000);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  const onPath = !!posture && (posture.dns.active || posture.dhcp.active || posture.capture.active || posture.gateway.enabled);
  const vms = topology?.nodes.filter((n) => n.kind === 'vm') ?? [];
  const vmsUp = vms.filter((v) => v.status === 'online').length;
  const gwMode = posture?.gateway.mode ?? 'off';
  const threats = sec?.activeAlerts ?? 0;

  const modules: ModuleSetting[] = [
    {
      href: '/dns',
      icon: Globe,
      label: 'DNS resolver',
      on: !!posture?.dns.active || (dns?.totalQueries ?? 0) > 0,
      state: posture?.dns.active ? 'active' : 'idle',
      summary: dns ? `${num(dns.totalQueries)} queries/24h · ${num(dns.uniqueClients)} clients · ${dns.blockedPct}% blocked` : 'loading…',
      configure: 'upstreams, blocklists, retention → DNS · Settings',
    },
    {
      href: '/dhcp',
      icon: Router,
      label: 'DHCP server',
      on: !!dhcpStatus?.running,
      state: dhcpStatus?.running ? 'serving' : 'stopped',
      summary: dhcp ? `${num(dhcp.inUse)}/${num(dhcp.totalAddresses)} leased · ${dhcp.scopes} scope${dhcp.scopes === 1 ? '' : 's'}` : 'loading…',
      configure: 'scopes, reservations, options → DHCP',
    },
    {
      href: '/directory',
      icon: UsersRound,
      label: 'Directory',
      on: !!dirStatus?.connected,
      state: dirStatus?.connected ? 'connected' : 'disconnected',
      summary: dirStatus?.connected ? `${dirStatus.domain ?? 'domain'} · DC ${dirStatus.host ?? ''}${dirStatus.remembered ? ' · retained' : ''}` : 'connect to an AD / Samba DC',
      configure: 'connection & credentials → Directory',
    },
    {
      href: '/security',
      icon: ShieldHalf,
      label: 'Security engine',
      on: true,
      tone: threats > 0 ? 'var(--danger)' : undefined,
      state: threats > 0 ? `${threats} active alert${threats === 1 ? '' : 's'}` : 'watching',
      summary: sec ? `posture ${sec.postureScore}/100 · capture ${posture?.capture.active ? 'on' : 'off'} · ${num(sec.uniqueClients)} devices seen` : 'loading…',
      configure: 'sensitivity & trusted hosts → Security · Threats',
    },
    {
      href: '/gateway',
      icon: Network,
      label: 'Network posture',
      on: gwMode !== 'off' || !!posture?.dhcp.active || !!posture?.capture.active,
      state: gwMode !== 'off' ? `gateway · ${gwMode}` : 'node only',
      summary: posture
        ? `dns ${posture.dns.active ? 'on' : 'off'} · dhcp ${posture.dhcp.active ? 'on' : 'off'} · capture ${posture.capture.active ? 'on' : 'off'} · gateway ${gwMode}`
        : 'stacking integration modes',
      configure: 'enable integration modes → Gateway',
    },
    {
      href: '/virtualization',
      icon: Server,
      label: 'Virtualization',
      on: vmsUp > 0,
      state: `${vmsUp}/${vms.length} reachable`,
      summary: vms.length ? 'fleet managed over SSH · encrypted credentials' : 'register VMs by SSH host + credentials',
      configure: 'add / manage VMs → Virtualization',
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      {/* appearance / theming */}
      <ThemePicker />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* control plane — live health */}
        <Panel brackets>
          <PanelHeader
            label="Control plane"
            title={health?.service ?? 'nexrelm-control-plane'}
            right={<StatusDot color={health?.status === 'operational' ? 'var(--good)' : 'var(--danger)'} />}
          />
          <div className="flex flex-col gap-3 px-5 pb-5 pt-3 text-sm">
            <Row icon={<Radio size={15} />} label="Mode">
              <Badge color={mode === 'live' ? 'var(--good)' : 'var(--accent-dim)'}>{status === 'loading' ? 'connecting' : mode}</Badge>
            </Row>
            <Row icon={<Server size={15} />} label="API">
              <span className="font-mono text-xs text-muted">{CONFIGURED_MODE === 'live' ? (apiUrl ?? 'live') : 'demo (in-browser simulator)'}</span>
            </Row>
            <Row icon={<Terminal size={15} />} label="Version">
              <span className="font-mono text-xs text-muted">v{health?.version ?? '—'}</span>
            </Row>
            <Row icon={<Database size={15} />} label="Uptime">
              <span className="stat text-xs text-text">{fmtUptime(health?.uptimeSec)}</span>
            </Row>
            <div className="panel-2 p-3 text-xs leading-relaxed text-muted">
              Runs as systemd unit <code className="font-mono text-accent">nexrelm-control-plane</code> — restart with{' '}
              <code className="font-mono text-text">sudo systemctl restart nexrelm-control-plane</code>, follow logs with{' '}
              <code className="font-mono text-text">journalctl -u nexrelm-control-plane -f</code>.
            </div>
          </div>
        </Panel>

        {/* about */}
        <Panel>
          <PanelHeader label="About" title="Nexrelm" hint="one nexus · every realm" />
          <div className="flex flex-col gap-3 px-5 pb-5 pt-3 text-sm">
            <p className="text-muted">
              An open-source network control plane unifying DNS, DHCP, Directory, Virtualization, Security and a live network map in one dark-cyber pane of glass.
            </p>
            <div className="flex flex-wrap gap-2">
              <Badge color="var(--accent)">v{health?.version ?? '0.1.0'}</Badge>
              <Badge color="var(--violet)">Apache-2.0</Badge>
              <Badge color="var(--good)">TypeScript</Badge>
              <Badge color="var(--accent-dim)">Fastify + Next.js</Badge>
            </div>
            <div className="mt-1 flex items-center justify-between rounded-lg border border-line bg-[var(--bg-2)]/40 px-3 py-2.5">
              <span className="flex items-center gap-2 text-xs">
                <Rocket size={14} className="text-accent" />
                <span className="text-muted">
                  Guided setup
                  <span className="ml-1.5 text-faint">{onPath ? '· Nexrelm is on the path' : '· not integrated yet'}</span>
                </span>
              </span>
              <Link href="/onboarding" className="flex items-center gap-1 rounded-md border border-accent/40 bg-[color-mix(in_oklch,var(--accent)_12%,transparent)] px-2.5 py-1 text-xs font-medium text-accent">
                {onPath ? 'Re-run' : 'Run setup'} <ArrowUpRight size={12} />
              </Link>
            </div>
            <p className="text-xs text-faint">Local git repository — no public remote configured yet.</p>
          </div>
        </Panel>
      </div>

      {/* module state — real, with links to where each module's settings live */}
      <Panel>
        <PanelHeader label="Modules" title="Live module state" hint="every value below is real — click a card to configure that module" />
        <div className="grid grid-cols-1 gap-3 px-5 pb-5 pt-3 sm:grid-cols-2 xl:grid-cols-3">
          {modules.map((m) => (
            <ModuleSettingCard key={m.href} {...m} />
          ))}
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* account — session + password */}
        <AccountPanel />

        {/* backend settings — retention enforced by the control plane */}
        <BackendPanel />

        {/* operations — deliberate privileged unlocks */}
        <Panel>
          <PanelHeader label="Operations" title="Privileged unlocks" hint="deliberately user-run — never auto-installed" />
          <div className="flex flex-col gap-3 px-5 pb-5 pt-3 text-sm">
            <div className="panel-2 p-3">
              <div className="flex items-center gap-2 text-xs font-medium text-text">
                <Network size={13} className="text-accent" /> Gateway routing
                <Badge color={posture?.gateway.available ? 'var(--good)' : 'var(--faint)'}>{posture?.gateway.available ? 'installed' : 'not installed'}</Badge>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                <code className="font-mono text-text">sudo bash deploy/install-gateway.sh</code> — installs the root helper + sudoers entry that unlocks
                device/LAN gateway modes (dead-man watchdog, kill switch). Remove with <code className="font-mono">--remove</code>.
              </p>
            </div>
            <div className="panel-2 p-3">
              <div className="flex items-center gap-2 text-xs font-medium text-text">
                <ShieldHalf size={13} className="text-accent" /> Scan & capture capabilities
              </div>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                <code className="font-mono text-text">sudo bash deploy/setup-scan-caps.sh</code> — grants nmap/tcpdump the capabilities for SYN scans, OS
                fingerprinting and promiscuous capture without running Nexrelm as root.
              </p>
            </div>
            <p className="text-xs text-faint">Everything privileged stays off by default; the GUI degrades gracefully until you opt in.</p>
          </div>
        </Panel>
      </div>
    </div>
  );
}

interface ModuleSetting {
  href: string;
  icon: LucideIcon;
  label: string;
  on: boolean;
  state: string;
  summary: string;
  configure: string;
  tone?: string;
}

function ModuleSettingCard({ href, icon: Icon, label, on, state, summary, configure, tone }: ModuleSetting) {
  const color = tone ?? (on ? 'var(--good)' : 'var(--faint)');
  return (
    <Link href={href} className="panel-2 group flex flex-col gap-2 p-4 transition-colors hover:border-accent/40">
      <div className="flex items-center gap-2">
        <span
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border"
          style={{ color, borderColor: `color-mix(in oklch, ${color} 40%, transparent)`, background: `color-mix(in oklch, ${color} 10%, var(--bg-2))` }}
        >
          <Icon size={15} strokeWidth={1.7} />
        </span>
        <span className="font-medium text-text">{label}</span>
        <Badge color={color}>{state}</Badge>
        <ArrowUpRight size={13} className="ml-auto text-faint opacity-0 transition-opacity group-hover:opacity-100" />
      </div>
      <p className="truncate text-xs text-muted" title={summary}>
        {summary}
      </p>
      <p className="text-[0.68rem] text-faint">{configure}</p>
    </Link>
  );
}

function Row({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="grid h-8 w-8 place-items-center rounded-lg border border-line text-faint">{icon}</span>
      <span className="label w-24">{label}</span>
      <span className="ml-auto">{children}</span>
    </div>
  );
}

// ── account: session + password ──────────────────────────────────────────────

function AccountPanel() {
  const { data: me } = useDns<AuthMe>('/api/auth/me', 0);
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const pwField = 'w-full rounded-lg border border-line bg-[var(--bg-2)] px-3 py-2 text-sm text-text outline-none placeholder:text-faint focus:border-accent/50';

  async function changePw() {
    if (newPw.length < 8) {
      setNote({ kind: 'err', text: 'new password must be at least 8 characters' });
      return;
    }
    if (newPw !== confirmPw) {
      setNote({ kind: 'err', text: 'passwords do not match' });
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      await dnsSend('POST', '/api/auth/password', { currentPassword: currentPw, newPassword: newPw });
      setNote({ kind: 'ok', text: 'password changed — other sessions were signed out' });
      setCurrentPw('');
      setNewPw('');
      setConfirmPw('');
    } catch (e) {
      setNote({ kind: 'err', text: e instanceof Error ? e.message : 'change failed' });
    } finally {
      setBusy(false);
    }
  }

  function signOut() {
    void dnsSend('POST', '/api/auth/logout').catch(() => undefined);
    clearToken();
    window.location.href = '/login';
  }

  return (
    <Panel>
      <PanelHeader
        label="Account"
        title={me ? `Signed in as ${me.username}` : 'Account'}
        hint="local admin — sessions expire after 7 days"
        right={
          <button onClick={signOut} className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs text-muted transition-colors hover:border-danger/40 hover:text-danger">
            <LogOut size={13} /> Sign out
          </button>
        }
      />
      <div className="flex flex-col gap-3 px-5 pb-5 pt-3">
        <div className="label">Change password</div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <input type="password" value={currentPw} onChange={(e) => setCurrentPw(e.target.value)} placeholder="current password" autoComplete="current-password" className={pwField} />
          <input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="new password (min 8)" autoComplete="new-password" className={pwField} />
          <input type="password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} placeholder="confirm new password" autoComplete="new-password" className={pwField} />
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={changePw}
            disabled={busy || !currentPw || !newPw || !confirmPw}
            className="flex items-center gap-1.5 rounded-lg border border-warn/40 bg-[color-mix(in_oklch,var(--warn)_12%,transparent)] px-3 py-2 text-sm font-medium text-warn disabled:opacity-50"
          >
            <KeyRound size={14} /> Change password
          </button>
          {note && <p className={cn('text-xs', note.kind === 'ok' ? 'text-good' : 'text-danger')}>{note.text}</p>}
        </div>
      </div>
    </Panel>
  );
}

// ── backend settings: retention windows + log buffer + storage footprint ──────

const STORE_DESC: Record<string, string> = {
  'dns.db': 'query log, lists, clients (SQLite)',
  'dhcp.db': 'scopes, leases, reservations, options',
  'security.db': 'device registry, baselines, tuning, events',
  'gateway.json': 'port-forwards & DHCP hand-off',
  'vms.json': 'VM fleet (passwords encrypted)',
  'secret.key': 'AES-256-GCM master key',
  'directory-session.enc': 'retained DC session (encrypted)',
  'vuln-intel.json': 'endoflife.date EOL cache',
  'system.json': 'these backend settings',
};

const fmtBytes = (b: number): string => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : b >= 1024 ? `${(b / 1024).toFixed(1)} KB` : `${b} B`);

function BackendPanel() {
  const { data, refresh } = useDns<SystemInfo>('/api/system/settings', 0);
  const [form, setForm] = useState<SystemSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // seed the form once from the live settings
  useEffect(() => {
    if (data && !form) setForm(data.settings);
  }, [data, form]);

  const set = (key: keyof SystemSettings) => (v: number) => setForm((f) => (f ? { ...f, [key]: v } : f));

  async function save() {
    if (!form) return;
    setBusy(true);
    setNote(null);
    try {
      await dnsSend('POST', '/api/system/settings', form);
      setNote({ kind: 'ok', text: 'saved — retention is enforced now and re-checked hourly' });
      refresh();
    } catch (e) {
      setNote({ kind: 'err', text: e instanceof Error ? e.message : 'save failed' });
    } finally {
      setBusy(false);
    }
  }

  async function prune() {
    setBusy(true);
    setNote(null);
    try {
      const r = await dnsSend<SystemPruneResult>('POST', '/api/system/prune');
      setNote({ kind: 'ok', text: `cleanup removed ${num(r.dnsQueries)} queries · ${num(r.dnsClients)} clients · ${num(r.securityEvents)} events · ${num(r.dhcpLeases)} leases` });
      refresh();
    } catch (e) {
      setNote({ kind: 'err', text: e instanceof Error ? e.message : 'cleanup failed' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel>
      <PanelHeader label="Backend" title="Data retention & maintenance" hint="enforced by the control plane — pruned hourly and on save" />
      <div className="flex flex-col gap-4 px-5 pb-5 pt-3">
        {form ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <NumField label="DNS query log" value={form.dnsQueryRetentionDays} onChange={set('dnsQueryRetentionDays')} suffix="days" hint="0 = keep forever" />
            <NumField label="Idle DNS clients" value={form.dnsClientRetentionDays} onChange={set('dnsClientRetentionDays')} suffix="days" hint="0 = keep forever" />
            <NumField label="Security events" value={form.securityEventRetentionDays} onChange={set('securityEventRetentionDays')} suffix="days" hint="0 = keep forever" />
            <NumField label="Expired DHCP leases" value={form.dhcpLeaseRetentionDays} onChange={set('dhcpLeaseRetentionDays')} suffix="days" hint="0 = keep forever" />
            <NumField label="Log buffer" value={form.logBufferLines} onChange={set('logBufferLines')} suffix="lines" hint="200 – 20,000 · applied live" />
          </div>
        ) : (
          <div className="py-4 text-center text-xs text-faint">loading settings…</div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={save}
            disabled={busy || !form}
            className="flex items-center gap-1.5 rounded-lg border border-accent/40 bg-[color-mix(in_oklch,var(--accent)_14%,transparent)] px-3 py-2 text-sm font-medium text-accent disabled:opacity-50"
          >
            <Save size={14} /> Save settings
          </button>
          <button onClick={prune} disabled={busy} className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-sm text-muted hover:text-text disabled:opacity-50">
            <Eraser size={14} /> Run cleanup now
          </button>
        </div>
        {note && <p className={cn('text-xs', note.kind === 'ok' ? 'text-good' : 'text-danger')}>{note.text}</p>}

        {/* live storage footprint */}
        <div>
          <div className="label mb-1.5">Storage · ~/.nexrelm</div>
          <div className="flex flex-col gap-1">
            {(data?.storage ?? []).map((s) => (
              <div key={s.file} className="flex items-baseline gap-3 rounded-lg px-2 py-1 transition-colors hover:bg-surface-2">
                <code className="w-44 shrink-0 truncate font-mono text-xs text-accent" title={s.file}>
                  {s.file}
                </code>
                <span className="min-w-0 flex-1 truncate text-xs text-muted">{STORE_DESC[s.file] ?? ''}</span>
                <span className="stat shrink-0 text-xs text-text">{fmtBytes(s.bytes)}</span>
              </div>
            ))}
            {!data?.storage?.length && <span className="px-2 text-xs text-faint">storage info unavailable</span>}
          </div>
        </div>
      </div>
    </Panel>
  );
}

function NumField({ label, value, onChange, suffix, hint }: { label: string; value: number; onChange: (v: number) => void; suffix: string; hint?: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="label">{label}</span>
      <span className="flex items-center gap-2">
        <input
          type="number"
          min={0}
          value={value}
          onChange={(e) => onChange(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
          className="w-28 rounded-lg border border-line bg-[var(--bg-2)] px-3 py-2 text-sm text-text outline-none focus:border-accent/50"
        />
        <span className="text-xs text-muted">{suffix}</span>
        {hint && <span className="ml-auto text-[0.64rem] text-faint">{hint}</span>}
      </span>
    </label>
  );
}
