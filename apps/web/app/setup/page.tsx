'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Hexagon, KeyRound, RefreshCw, ShieldCheck, TerminalSquare } from 'lucide-react';
import type { AuthStatus } from '@nexrelm/types';
import { dnsGet } from '@/lib/dns';
import { Panel } from '@/components/ui/Panel';

/**
 * Not a wizard — setup happens on the server (bash installer / nexrelm CLI), so
 * the admin password is only ever shown on the console, never over HTTP. This
 * page tells the operator what to run and polls until the account exists, then
 * sends them to sign in.
 */
export default function SetupPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(false);

  // poll: once the installer has created the account, move on to /login
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const s = await dnsGet<AuthStatus>('/api/auth/status');
        if (alive && s.initialized) router.replace('/login');
      } catch {
        /* control plane unreachable — keep showing the instructions */
      }
    };
    const t = setInterval(tick, 4000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [router]);

  async function checkNow() {
    setChecking(true);
    try {
      const s = await dnsGet<AuthStatus>('/api/auth/status');
      if (s.initialized) router.replace('/login');
    } catch {
      /* ignore */
    } finally {
      setTimeout(() => setChecking(false), 600);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-xl">
        <div className="mb-6 flex flex-col items-center">
          <div className="relative">
            <Hexagon className="h-12 w-12 text-accent" strokeWidth={1.3} />
            <span className="absolute inset-0 grid place-items-center font-mono text-sm font-bold text-accent">N</span>
          </div>
          <span className="mt-3 font-mono text-lg font-semibold tracking-[0.28em] text-text">NEXRELM</span>
          <span className="mt-1 text-xs tracking-wide text-faint">one nexus · every realm</span>
        </div>

        <Panel brackets>
          <div className="flex flex-col gap-4 px-7 py-7">
            <h1 className="flex items-center gap-2 text-lg font-semibold text-text">
              <TerminalSquare size={18} className="text-accent" /> Finish setup on the server
            </h1>
            <p className="text-sm leading-relaxed text-muted">
              Nexrelm isn't set up yet. For security, the admin account is created on the server — the password is shown on the console and never travels
              over the network. Run the installer where Nexrelm lives:
            </p>

            <div className="rounded-lg border border-line bg-[var(--bg-2)] p-3 font-mono text-sm text-text">
              <span className="select-all">sudo bash deploy/install-nexrelm.sh</span>
            </div>
            <p className="text-xs text-muted">
              It installs dependencies, builds the app, registers the <code className="font-mono text-text">nexrelm</code> command, starts the control plane,
              and prints your one-time admin password.
            </p>

            <ul className="flex flex-col gap-2 rounded-lg border border-line bg-[var(--bg-2)]/40 p-3 text-sm text-muted">
              <li className="flex items-center gap-2"><ShieldCheck size={14} className="text-accent" /> Creates <code className="font-mono text-text">admin</code> + a strong generated password</li>
              <li className="flex items-center gap-2"><KeyRound size={14} className="text-accent" /> First sign-in here asks you to set your own password</li>
              <li className="flex items-center gap-2"><TerminalSquare size={14} className="text-accent" /> Locked out later? <code className="font-mono text-text">sudo nexrelm reset-password</code></li>
            </ul>

            <div className="flex items-center gap-3">
              <button
                onClick={checkNow}
                className="flex w-fit items-center gap-2 rounded-lg border border-accent/40 bg-[color-mix(in_oklch,var(--accent)_14%,transparent)] px-4 py-2.5 text-sm font-medium text-accent"
              >
                <RefreshCw size={15} className={checking ? 'animate-spin' : undefined} /> I've run the installer
              </button>
              <span className="text-xs text-faint">checking automatically…</span>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}
