'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Activity, LogOut, Moon, Radio, Sun } from 'lucide-react';
import { NAV } from '@/lib/nav';
import { uptime } from '@/lib/format';
import { useNexrelm } from '@/components/providers/NexrelmProvider';
import { useTheme } from '@/components/providers/ThemeProvider';
import { StatusDot } from '@/components/ui/StatusDot';
import { dnsSend } from '@/lib/dns';
import { clearToken, getToken } from '@/lib/auth';

function useNow(): Date | null {
  // Stays null on the server + first client render so SSR and hydration agree;
  // the real (constantly-changing) time only appears after mount.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function current(pathname: string): { label: string; hint: string } {
  const hit = [...NAV].reverse().find((n) => (n.href === '/' ? pathname === '/' : pathname.startsWith(n.href)));
  return hit ? { label: hit.label, hint: hit.hint } : { label: 'Dashboard', hint: 'Network overview' };
}

export function Topbar() {
  const pathname = usePathname();
  const { status, snapshot, eventCount } = useNexrelm();
  const now = useNow();
  const page = current(pathname);
  const { mode, toggleMode } = useTheme();
  // read localStorage only after mount so SSR and hydration agree
  const [hasSession, setHasSession] = useState(false);
  useEffect(() => setHasSession(!!getToken()), []);

  const conn =
    status === 'live'
      ? { color: 'var(--good)', text: 'LIVE' }
      : status === 'demo'
        ? { color: 'var(--accent)', text: 'DEMO' }
        : { color: 'var(--warn)', text: 'SYNC' };

  return (
    <header className="sticky top-0 z-10 flex h-16 items-center justify-between gap-4 border-b border-line bg-[var(--bg)]/72 px-5 backdrop-blur-xl">
      <div className="min-w-0">
        <h1 className="truncate text-lg font-semibold tracking-tight text-text">{page.label}</h1>
        <p className="truncate text-xs text-faint">{page.hint}</p>
      </div>

      <div className="flex items-center gap-2.5 sm:gap-4">
        {/* live event pulse */}
        <div className="hidden items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 sm:flex">
          <Activity size={13} className="text-accent" />
          <span className="font-mono text-[0.72rem] tabular-nums text-muted">
            {eventCount.toLocaleString()} <span className="text-faint">events</span>
          </span>
        </div>

        {/* uptime */}
        {snapshot && (
          <div className="hidden items-center gap-2 md:flex">
            <span className="label">uptime</span>
            <span className="stat text-sm text-text">{uptime(snapshot.dashboard.uptimeSec)}</span>
          </div>
        )}

        {/* clock — rendered only after mount to avoid SSR/client time mismatch */}
        <time className="stat hidden text-sm tabular-nums text-text lg:block" suppressHydrationWarning>
          {now ? now.toLocaleTimeString('en-GB', { hour12: false }) : '--:--:--'}
        </time>

        {/* connection */}
        <div
          className="flex items-center gap-2 rounded-full border px-3 py-1.5"
          style={{ borderColor: 'color-mix(in oklch, ' + conn.color + ' 36%, transparent)' }}
        >
          <StatusDot color={conn.color} pulse={status !== 'loading'} />
          <span className="font-mono text-[0.72rem] font-medium tracking-wider" style={{ color: conn.color }}>
            {conn.text}
          </span>
          <Radio size={12} className="hidden text-faint sm:block" />
        </div>

        {/* light/dark toggle */}
        <button
          onClick={toggleMode}
          title={mode === 'dark' ? 'Switch to light' : 'Switch to dark'}
          aria-label="Toggle light/dark"
          className="grid h-8 w-8 place-items-center rounded-full border border-line text-muted transition-colors hover:border-accent/40 hover:text-text"
        >
          {mode === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
        </button>

        {/* sign out (only when a session exists) */}
        {hasSession && (
          <button
            onClick={() => {
              void dnsSend('POST', '/api/auth/logout').catch(() => undefined);
              clearToken();
              window.location.href = '/login';
            }}
            title="Sign out"
            aria-label="Sign out"
            className="grid h-8 w-8 place-items-center rounded-full border border-line text-faint transition-colors hover:border-danger/40 hover:text-danger"
          >
            <LogOut size={14} />
          </button>
        )}
      </div>
    </header>
  );
}
