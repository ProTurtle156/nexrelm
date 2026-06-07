'use client';

import { useEffect, useRef, useState } from 'react';
import { Shield, ShieldOff, ChevronDown, Server, AlertTriangle } from 'lucide-react';
import type { DnsResolverStatus } from '@nexrelm/types';
import { dnsSend } from '@/lib/dns';
import { cn } from '@/lib/format';
import { StatusDot } from '@/components/ui/StatusDot';

const DURATIONS: Array<{ label: string; seconds: number }> = [
  { label: '10 seconds', seconds: 10 },
  { label: '30 seconds', seconds: 30 },
  { label: '5 minutes', seconds: 300 },
  { label: '1 hour', seconds: 3600 },
  { label: 'Indefinitely', seconds: 0 },
];

function useCountdown(until: string | null | undefined): number | null {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    if (!until) {
      setLeft(null);
      return;
    }
    const compute = () => Math.max(0, Math.round((new Date(until).getTime() - Date.now()) / 1000));
    setLeft(compute());
    const t = setInterval(() => setLeft(compute()), 1000);
    return () => clearInterval(t);
  }, [until]);
  return left;
}

interface StatusBarProps {
  status: DnsResolverStatus | null;
  error: string | null;
  onChange: () => void;
}

export function StatusBar({ status, error, onChange }: StatusBarProps) {
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const blocking = status?.blocking;
  const countdown = useCountdown(blocking?.disabledUntil);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  async function set(action: 'enable' | 'disable', seconds?: number) {
    setBusy(true);
    setMenu(false);
    try {
      await dnsSend('POST', '/api/dns/blocking', { action, seconds });
      onChange();
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <div className="panel flex items-center gap-3 px-5 py-3.5">
        <AlertTriangle size={18} className="text-warn" />
        <div>
          <div className="text-sm font-medium text-text">Resolver unreachable</div>
          <div className="text-xs text-faint">
            Start the control plane (<code className="font-mono text-accent">npm run dev:api</code>) — {error}
          </div>
        </div>
      </div>
    );
  }

  const enabled = blocking?.enabled ?? true;

  return (
    <div className="panel relative z-30 flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-3.5">
      {/* resolver bind */}
      <div className="flex items-center gap-2.5">
        <StatusDot color={status?.running ? 'var(--good)' : 'var(--danger)'} />
        <div>
          <div className="label">Resolver</div>
          <div className="stat text-sm text-text">
            {status?.running ? `${status.bind}:${status.port}` : 'stopped'}
            {status && !status.privileged && status.running && (
              <span className="ml-2 font-mono text-[0.62rem] text-warn">unprivileged</span>
            )}
          </div>
        </div>
      </div>

      {/* upstreams */}
      <div className="flex items-center gap-2">
        <Server size={14} className="text-faint" />
        <div>
          <div className="label">Upstreams</div>
          <div className="flex items-center gap-2">
            {status?.upstreams.map((u) => (
              <span key={u.addr} className="flex items-center gap-1 font-mono text-[0.72rem] text-muted">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: u.healthy ? 'var(--good)' : 'var(--danger)' }} />
                {u.addr}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* blocking control */}
      <div ref={ref} className="relative ml-auto">
        {enabled ? (
          <div className="flex">
            <button
              disabled={busy}
              onClick={() => set('disable', 0)}
              className="flex items-center gap-2 rounded-l-xl border border-danger/40 bg-[color-mix(in_oklch,var(--danger)_12%,transparent)] px-4 py-2 text-sm font-medium text-danger transition-colors hover:bg-[color-mix(in_oklch,var(--danger)_20%,transparent)] disabled:opacity-50"
            >
              <ShieldOff size={15} /> Disable blocking
            </button>
            <button
              disabled={busy}
              onClick={() => setMenu((m) => !m)}
              className="rounded-r-xl border border-l-0 border-danger/40 bg-[color-mix(in_oklch,var(--danger)_12%,transparent)] px-2 py-2 text-danger transition-colors hover:bg-[color-mix(in_oklch,var(--danger)_20%,transparent)]"
            >
              <ChevronDown size={15} />
            </button>
          </div>
        ) : (
          <button
            disabled={busy}
            onClick={() => set('enable')}
            className="flex items-center gap-2 rounded-xl border border-good/40 bg-[color-mix(in_oklch,var(--good)_12%,transparent)] px-4 py-2 text-sm font-medium text-good transition-colors hover:bg-[color-mix(in_oklch,var(--good)_20%,transparent)] disabled:opacity-50"
          >
            <Shield size={15} /> Enable blocking
            {countdown != null && <span className="font-mono text-xs text-muted">({countdown}s)</span>}
            {countdown == null && <span className="font-mono text-xs text-muted">(paused)</span>}
          </button>
        )}

        {menu && (
          <div className="absolute right-0 z-30 mt-2 w-44 overflow-hidden rounded-xl border border-line bg-[var(--bg-2)] shadow-panel">
            {DURATIONS.map((d) => (
              <button
                key={d.label}
                onClick={() => set('disable', d.seconds)}
                className="block w-full px-4 py-2 text-left text-sm text-muted transition-colors hover:bg-[color-mix(in_oklch,var(--accent)_10%,transparent)] hover:text-text"
              >
                {d.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
