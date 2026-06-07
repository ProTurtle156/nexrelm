'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Hexagon, KeyRound, LogIn, ShieldCheck } from 'lucide-react';
import type { AuthSession } from '@nexrelm/types';
import { dnsSend } from '@/lib/dns';
import { setToken } from '@/lib/auth';
import { Panel } from '@/components/ui/Panel';

const field = 'w-full rounded-lg border border-line bg-[var(--bg-2)] px-3 py-2.5 text-sm text-text outline-none placeholder:text-faint focus:border-accent/50';

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // first-login forced change
  const [mustChange, setMustChange] = useState(false);
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');

  async function signIn(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const s = await dnsSend<AuthSession>('POST', '/api/auth/login', { username, password });
      setToken(s.token);
      if (s.mustChangePassword) {
        setMustChange(true); // password stays in state as "current" for the change call
      } else {
        window.location.href = '/'; // full reload so the WS reconnects with the session
      }
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : 'sign-in failed');
    } finally {
      setBusy(false);
    }
  }

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    if (newPw.length < 8) {
      setError('new password must be at least 8 characters');
      return;
    }
    if (newPw !== confirmPw) {
      setError('passwords do not match');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await dnsSend('POST', '/api/auth/password', { currentPassword: password, newPassword: newPw });
      window.location.href = '/';
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : 'password change failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center">
          <div className="relative">
            <Hexagon className="h-12 w-12 text-accent" strokeWidth={1.3} />
            <span className="absolute inset-0 grid place-items-center font-mono text-sm font-bold text-accent">N</span>
          </div>
          <span className="mt-3 font-mono text-lg font-semibold tracking-[0.28em] text-text">NEXRELM</span>
          <span className="mt-1 text-xs tracking-wide text-faint">one nexus · every realm</span>
        </div>

        <Panel brackets>
          {!mustChange ? (
            <form onSubmit={signIn} className="flex flex-col gap-3 px-6 py-6">
              <h1 className="mb-1 text-base font-semibold text-text">Sign in</h1>
              <label className="flex flex-col gap-1">
                <span className="label">Username</span>
                <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" className={field} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="label">Password</span>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" autoFocus className={field} />
              </label>
              {error && <p className="rounded-lg border border-danger/30 bg-[color-mix(in_oklch,var(--danger)_8%,transparent)] px-3 py-2 text-xs text-danger">{error}</p>}
              <button
                type="submit"
                disabled={busy || !password}
                className="mt-1 flex items-center justify-center gap-2 rounded-lg border border-accent/40 bg-[color-mix(in_oklch,var(--accent)_14%,transparent)] px-4 py-2.5 text-sm font-medium text-accent disabled:opacity-50"
              >
                <LogIn size={15} /> {busy ? 'signing in…' : 'Sign in'}
              </button>
            </form>
          ) : (
            <form onSubmit={changePassword} className="flex flex-col gap-3 px-6 py-6">
              <h1 className="mb-1 flex items-center gap-2 text-base font-semibold text-text">
                <ShieldCheck size={17} className="text-warn" /> Set your own password
              </h1>
              <p className="text-xs leading-relaxed text-muted">
                You signed in with the generated install password. Choose your own to continue — the generated one stops working immediately.
              </p>
              <label className="flex flex-col gap-1">
                <span className="label">New password</span>
                <input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} autoComplete="new-password" autoFocus className={field} placeholder="at least 8 characters" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="label">Confirm new password</span>
                <input type="password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} autoComplete="new-password" className={field} />
              </label>
              {error && <p className="rounded-lg border border-danger/30 bg-[color-mix(in_oklch,var(--danger)_8%,transparent)] px-3 py-2 text-xs text-danger">{error}</p>}
              <button
                type="submit"
                disabled={busy || !newPw || !confirmPw}
                className="mt-1 flex items-center justify-center gap-2 rounded-lg border border-warn/40 bg-[color-mix(in_oklch,var(--warn)_12%,transparent)] px-4 py-2.5 text-sm font-medium text-warn disabled:opacity-50"
              >
                <KeyRound size={15} /> {busy ? 'saving…' : 'Set password & continue'}
              </button>
            </form>
          )}
        </Panel>
      </div>
    </div>
  );
}
