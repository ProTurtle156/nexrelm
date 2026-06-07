'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  Globe,
  Network,
  Radar,
  Radio,
  ShieldAlert,
  TerminalSquare,
  Wifi,
  type LucideIcon,
} from 'lucide-react';
import type { OnboardingState, OnboardingVerify } from '@nexrelm/types';
import { dnsSend, useDns } from '@/lib/dns';
import { cn } from '@/lib/format';
import { Panel } from '@/components/ui/Panel';

const STEPS = ['Detect', 'Capabilities', 'Integration', 'Capture', 'Verify'] as const;
type Mode = 'dns' | 'gateway';

export function OnboardingWizard() {
  const router = useRouter();
  const { data, refresh } = useDns<OnboardingState>('/api/onboarding', 5000);
  const [step, setStep] = useState(0);
  const [mode, setMode] = useState<Mode | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [verify, setVerify] = useState<OnboardingVerify | null>(null);

  const next = () => setStep((s) => Math.min(STEPS.length - 1, s + 1));
  const back = () => setStep((s) => Math.max(0, s - 1));

  async function act(fn: () => Promise<unknown>, ok?: string) {
    setBusy(true);
    setNote(null);
    try {
      await fn();
      if (ok) setNote(ok);
      refresh();
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'action failed');
    } finally {
      setBusy(false);
    }
  }

  async function runVerify() {
    setBusy(true);
    setVerify(null);
    try {
      const r = await dnsSend<OnboardingVerify>('POST', '/api/onboarding/verify');
      setVerify(r);
      refresh();
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl">
      {/* stepper */}
      <div className="mb-5 flex items-center justify-center gap-1.5 text-[0.64rem] uppercase tracking-wider">
        {STEPS.map((s, i) => (
          <span key={s} className="flex items-center gap-1.5">
            {i > 0 && <span className="h-px w-6 bg-[var(--line-strong)]" />}
            <span className={cn('rounded-full border px-2.5 py-1 transition-colors', i === step ? 'border-accent/60 text-accent' : i < step ? 'border-good/40 text-good' : 'border-line text-faint')}>
              {i < step ? '✓' : i + 1} · {s}
            </span>
          </span>
        ))}
      </div>

      <Panel brackets>
        <div className="px-7 py-7">
          {!data ? (
            <div className="py-10 text-center text-sm text-faint">probing your network…</div>
          ) : (
            <>
              {step === 0 && <StepDetect data={data} />}
              {step === 1 && <StepCaps data={data} onRecheck={refresh} />}
              {step === 2 && <StepIntegration data={data} mode={mode} setMode={setMode} act={act} busy={busy} />}
              {step === 3 && <StepCapture data={data} act={act} busy={busy} />}
              {step === 4 && <StepVerify data={data} verify={verify} onVerify={runVerify} busy={busy} />}
              {note && <p className="mt-4 text-xs text-accent">{note}</p>}
            </>
          )}

          {/* nav */}
          <div className="mt-7 flex items-center justify-between border-t border-line pt-4">
            <button onClick={back} disabled={step === 0} className="flex items-center gap-1.5 text-sm text-muted hover:text-text disabled:opacity-30">
              <ArrowLeft size={15} /> Back
            </button>
            {step < STEPS.length - 1 ? (
              <button onClick={next} className="flex items-center gap-1.5 rounded-lg border border-accent/40 bg-[color-mix(in_oklch,var(--accent)_14%,transparent)] px-4 py-2 text-sm font-medium text-accent">
                Next <ArrowRight size={15} />
              </button>
            ) : (
              <button onClick={() => router.replace('/')} className="flex items-center gap-1.5 rounded-lg border border-good/40 bg-[color-mix(in_oklch,var(--good)_14%,transparent)] px-4 py-2 text-sm font-medium text-good">
                Finish <Check size={15} />
              </button>
            )}
          </div>
        </div>
      </Panel>
    </div>
  );
}

// ── step 1: detect ────────────────────────────────────────────────────────────
function StepDetect({ data }: { data: OnboardingState }) {
  return (
    <div className="flex flex-col gap-4">
      <Header icon={Wifi} title="Your network" sub="Auto-detected — this is the segment Nexrelm will watch." />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Nexrelm IP" value={data.lan.ip || '—'} mono accent />
        <Stat label="LAN subnet" value={data.lan.cidr || '—'} mono />
        <Stat label="Interface" value={data.lan.iface || '—'} mono />
        <Stat label="Uplink (WAN)" value={data.wanIface || '—'} mono />
        <Stat label="Point DNS at" value={data.dnsPointAt || '—'} mono accent />
      </div>
      <p className="text-xs leading-relaxed text-muted">
        Nexrelm sits as a node on this LAN. To see the whole network you either point devices' DNS at it (easiest) or route them through it as the
        gateway (most powerful). The next steps set that up and confirm traffic is flowing.
      </p>
    </div>
  );
}

// ── step 2: capabilities ──────────────────────────────────────────────────────
function StepCaps({ data, onRecheck }: { data: OnboardingState; onRecheck: () => void }) {
  const allGood = data.caps.capture && data.caps.scan;
  return (
    <div className="flex flex-col gap-4">
      <Header icon={ShieldAlert} title="Capabilities" sub="Packet capture and scanning need Linux capabilities — granted once, no root daemon." />
      <div className="flex flex-col gap-2">
        <CapRow ok={data.caps.capture} label="Promiscuous capture" detail="tcpdump · cap_net_raw — wire & L2 threat detection, live traffic" />
        <CapRow ok={data.caps.scan} label="Network scanning" detail="nmap · cap_net_raw — SYN / version / OS fingerprinting" />
      </div>
      {!allGood && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted">Run this once on the server to grant them:</p>
          <CommandLine cmd="sudo bash deploy/setup-scan-caps.sh" />
        </div>
      )}
      <div className="flex items-center gap-3">
        <button onClick={onRecheck} className="flex w-fit items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-sm text-muted hover:text-text">
          <Radio size={14} /> Re-check
        </button>
        {allGood ? <span className="text-xs text-good">all capabilities granted</span> : <span className="text-xs text-faint">capture is needed for live traffic; you can continue and grant it later</span>}
      </div>
    </div>
  );
}

// ── step 3: integration mode ──────────────────────────────────────────────────
function StepIntegration({ data, mode, setMode, act, busy }: { data: OnboardingState; mode: Mode | null; setMode: (m: Mode) => void; act: (fn: () => Promise<unknown>, ok?: string) => void; busy: boolean }) {
  return (
    <div className="flex flex-col gap-4">
      <Header icon={Network} title="How should Nexrelm see your network?" sub="Pick one. You can change or stack these any time from the Gateway page." />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <ModeCard
          icon={Globe}
          active={mode === 'dns'}
          recommended
          title="Make me your DNS"
          tagline="Easiest · non-disruptive"
          onClick={() => setMode('dns')}
        >
          <p>Point your router's <span className="text-text">DNS server</span> setting at Nexrelm, or let Nexrelm run DHCP. Every lookup flows through it — blocking, sinkholing, per-client DNS visibility — with zero per-device setup.</p>
          {mode === 'dns' && (
            <div className="mt-2 flex flex-col gap-2">
              <div className="rounded-md border border-line bg-[var(--bg-2)] p-2 text-[0.7rem] text-muted">
                In your router's DHCP/LAN settings, set <span className="font-mono text-accent">DNS = {data.dnsPointAt || data.lan.ip}</span> and save. Clients pick it up on their next lease.
              </div>
              <button
                onClick={() => act(() => dnsSend('POST', '/api/security/network/dhcp', { enabled: true }), 'Nexrelm DHCP enabled — it will advertise itself as DNS to clients.')}
                disabled={busy || data.posture.dhcp.active}
                className="w-fit rounded-md border border-accent/40 bg-[color-mix(in_oklch,var(--accent)_12%,transparent)] px-3 py-1.5 text-[0.72rem] font-medium text-accent disabled:opacity-50"
              >
                {data.posture.dhcp.active ? 'Nexrelm DHCP is on' : 'Or: turn on Nexrelm DHCP'}
              </button>
            </div>
          )}
        </ModeCard>

        <ModeCard
          icon={Radar}
          active={mode === 'gateway'}
          title="Make me your gateway"
          tagline="Most powerful · on-path"
          onClick={() => setMode('gateway')}
        >
          <p>Route the whole LAN through Nexrelm. <span className="text-text">All</span> traffic becomes visible and enforceable — full firewall, every protocol, network-wide. Disruptive: it changes routing.</p>
          {mode === 'gateway' && (
            <div className="mt-2 flex flex-col gap-2">
              {data.gatewayAvailable ? (
                <button
                  onClick={() => act(() => dnsSend('POST', '/api/security/gateway', { action: 'lan' }), 'LAN gateway enabled — Nexrelm is now on the path.')}
                  disabled={busy || data.posture.gateway.enabled}
                  className="w-fit rounded-md border border-warn/40 bg-[color-mix(in_oklch,var(--warn)_12%,transparent)] px-3 py-1.5 text-[0.72rem] font-medium text-warn disabled:opacity-50"
                >
                  {data.posture.gateway.enabled ? `gateway active (${data.posture.gateway.mode})` : 'Enable LAN gateway'}
                </button>
              ) : data.posture.gateway.installed ? (
                <div className="flex flex-col gap-1.5">
                  <span className="text-[0.7rem] text-faint">
                    The helper is installed but the control plane{data.posture.gateway.runAs ? <> (user <span className="text-muted">{data.posture.gateway.runAs}</span>)</> : ''} can’t invoke it via sudo. Re-run on the server:
                  </span>
                  <CommandLine cmd={`sudo NEXRELM_USER=${data.posture.gateway.runAs || '<service-user>'} bash deploy/install-gateway.sh`} small />
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  <span className="text-[0.7rem] text-faint">The routing helper isn't installed yet. Run on the server:</span>
                  <CommandLine cmd="sudo bash deploy/install-gateway.sh" small />
                </div>
              )}
            </div>
          )}
        </ModeCard>
      </div>
    </div>
  );
}

// ── step 4: capture ───────────────────────────────────────────────────────────
function StepCapture({ data, act, busy }: { data: OnboardingState; act: (fn: () => Promise<unknown>, ok?: string) => void; busy: boolean }) {
  const on = data.posture.capture.active;
  return (
    <div className="flex flex-col gap-4">
      <Header icon={Radio} title="Start watching traffic" sub="Turn on the promiscuous sniffer so Nexrelm sees the wire (L2/ARP, scans, egress)." />
      <div className="flex items-center gap-4 rounded-lg border border-line bg-[var(--bg-2)]/40 p-4">
        <span className={cn('grid h-11 w-11 place-items-center rounded-xl border', on ? 'border-good/50 text-good' : 'border-line text-faint')} style={on ? { background: 'color-mix(in oklch, var(--good) 12%, transparent)' } : undefined}>
          <Radio size={20} className={on ? 'animate-pulse-dot' : undefined} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-text">{on ? 'Capture is running' : 'Capture is off'}</div>
          <div className="text-xs text-muted">{on ? `${data.posture.capture.packets.toLocaleString()} packets on ${data.posture.capture.iface || '—'}` : 'No wire visibility yet'}</div>
        </div>
        <button
          onClick={() => act(() => dnsSend('POST', '/api/security/sniffer', { action: on ? 'stop' : 'start' }), on ? 'Capture stopped.' : 'Capture started.')}
          disabled={busy || (!on && !data.caps.capture)}
          className={cn('rounded-lg border px-4 py-2 text-sm font-medium disabled:opacity-50', on ? 'border-line text-muted hover:text-text' : 'border-accent/40 bg-[color-mix(in_oklch,var(--accent)_14%,transparent)] text-accent')}
        >
          {on ? 'Stop' : 'Start capture'}
        </button>
      </div>
      {!on && !data.caps.capture && <p className="text-xs text-warn">Capture capability isn't granted — go back to step 2 and run the cap-grant command, then re-check.</p>}
      <p className="text-xs text-muted">On a plain switch you'll see this host's traffic plus broadcast/L2. For full network-wide visibility, use a mirror/SPAN port or the gateway mode from the previous step.</p>
    </div>
  );
}

// ── step 5: verify ────────────────────────────────────────────────────────────
function StepVerify({ data, verify, onVerify, busy }: { data: OnboardingState; verify: OnboardingVerify | null; onVerify: () => void; busy: boolean }) {
  return (
    <div className="flex flex-col gap-4">
      <Header icon={Check} title="Verify traffic is flowing" sub="Confirm Nexrelm can actually see your network before you rely on it." />
      <div className="rounded-lg border border-line bg-[var(--bg-2)]/40 p-4 text-sm">
        <div className="mb-1 text-xs text-muted">Live signal</div>
        <div className={cn('font-medium', data.trafficFlowing ? 'text-good' : 'text-faint')}>{data.trafficSignal}</div>
      </div>
      <button
        onClick={onVerify}
        disabled={busy}
        className="flex w-fit items-center gap-2 rounded-lg border border-accent/40 bg-[color-mix(in_oklch,var(--accent)_14%,transparent)] px-4 py-2 text-sm font-medium text-accent disabled:opacity-50"
      >
        <Radar size={15} className={busy ? 'animate-spin' : undefined} /> {busy ? 'sampling traffic…' : 'Verify now'}
      </button>
      {verify && (
        <div className={cn('rounded-lg border p-4', verify.flowing ? 'border-good/40' : 'border-warn/40')} style={{ background: `color-mix(in oklch, ${verify.flowing ? 'var(--good)' : 'var(--warn)'} 7%, transparent)` }}>
          <div className={cn('flex items-center gap-2 text-sm font-semibold', verify.flowing ? 'text-good' : 'text-warn')}>
            {verify.flowing ? <Check size={16} /> : <ShieldAlert size={16} />}
            {verify.flowing ? 'Traffic is flowing — Nexrelm is watching your network.' : 'No traffic seen yet'}
          </div>
          <p className="mt-1 text-xs text-muted">{verify.detail}</p>
        </div>
      )}
    </div>
  );
}

// ── shared bits ───────────────────────────────────────────────────────────────
function Header({ icon: Icon, title, sub }: { icon: LucideIcon; title: string; sub: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-accent/40 text-accent" style={{ background: 'color-mix(in oklch, var(--accent) 10%, transparent)' }}>
        <Icon size={18} strokeWidth={1.6} />
      </span>
      <div>
        <h1 className="text-base font-semibold text-text">{title}</h1>
        <p className="mt-0.5 text-xs leading-relaxed text-muted">{sub}</p>
      </div>
    </div>
  );
}

function Stat({ label, value, mono, accent }: { label: string; value: string; mono?: boolean; accent?: boolean }) {
  return (
    <div className="panel-2 px-3 py-2">
      <div className="label">{label}</div>
      <div className={cn('mt-0.5 truncate text-sm', mono && 'font-mono text-xs', accent ? 'text-accent' : 'text-text')} title={value}>
        {value}
      </div>
    </div>
  );
}

function CapRow({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-line bg-[var(--bg-2)]/40 px-3 py-2.5">
      <span className={cn('grid h-7 w-7 shrink-0 place-items-center rounded-full border', ok ? 'border-good/50 text-good' : 'border-warn/50 text-warn')}>
        {ok ? <Check size={14} /> : <ShieldAlert size={13} />}
      </span>
      <div className="min-w-0">
        <div className="text-sm font-medium text-text">{label}</div>
        <div className="truncate font-mono text-[0.66rem] text-faint">{detail}</div>
      </div>
      <span className={cn('ml-auto text-xs', ok ? 'text-good' : 'text-warn')}>{ok ? 'granted' : 'missing'}</span>
    </div>
  );
}

function CommandLine({ cmd, small }: { cmd: string; small?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={cn('flex items-stretch gap-2', small && 'text-xs')}>
      <code className="flex-1 select-all rounded-lg border border-line bg-[var(--bg-2)] px-3 py-2 font-mono text-text">
        <TerminalSquare size={12} className="mr-2 inline text-faint" />
        {cmd}
      </code>
      <button
        onClick={() => {
          navigator.clipboard?.writeText(cmd).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
        className="flex items-center gap-1 rounded-lg border border-line px-3 text-xs text-muted hover:text-text"
      >
        {copied ? <Check size={13} className="text-good" /> : <Copy size={13} />}
      </button>
    </div>
  );
}

function ModeCard({ icon: Icon, active, recommended, title, tagline, onClick, children }: { icon: LucideIcon; active: boolean; recommended?: boolean; title: string; tagline: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={cn('flex flex-col gap-2 rounded-xl border p-4 text-left transition-colors', active ? 'border-accent/60' : 'border-line hover:border-line-strong')} style={active ? { background: 'color-mix(in oklch, var(--accent) 7%, transparent)' } : undefined}>
      <div className="flex items-center gap-2">
        <span className={cn('grid h-8 w-8 place-items-center rounded-lg border', active ? 'border-accent/50 text-accent' : 'border-line text-muted')}>
          <Icon size={16} strokeWidth={1.7} />
        </span>
        <span className="text-sm font-semibold text-text">{title}</span>
        {recommended && <span className="ml-auto rounded-full border border-good/40 px-2 py-0.5 text-[0.6rem] uppercase tracking-wider text-good">recommended</span>}
      </div>
      <span className="text-[0.66rem] uppercase tracking-wider text-faint">{tagline}</span>
      <div className="text-xs leading-relaxed text-muted">{children}</div>
    </button>
  );
}
