'use client';

import { useState } from 'react';
import { Server, Lock, ShieldQuestion, Plug } from 'lucide-react';
import type { DirectoryConnectInput, DirectoryMode, DirectorySecurity, DirectoryStatus } from '@nexrelm/types';
import { dirSend } from '@/lib/directory';
import { cn } from '@/lib/format';
import { Panel, PanelHeader } from '@/components/ui/Panel';

const cls = 'w-full rounded-lg border border-line bg-[var(--bg-2)] px-3 py-2 text-sm text-text outline-none placeholder:text-faint focus:border-accent/50';

export function Connect({ onConnected, prevError }: { onConnected: () => void; prevError?: string }) {
  const [mode, setMode] = useState<DirectoryMode>('ad');
  const [host, setHost] = useState('');
  const [domain, setDomain] = useState('');
  const [username, setUsername] = useState('Administrator');
  const [password, setPassword] = useState('');
  const [security, setSecurity] = useState<DirectorySecurity>('plain');
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(prevError);

  async function connect() {
    if (!host || !domain || !username || !password) {
      setError('Fill in the domain controller, domain, username and password.');
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const body: DirectoryConnectInput = { mode, host: host.trim(), domain: domain.trim(), username: username.trim(), password, security, remember };
      const status = await dirSend<DirectoryStatus>('POST', '/api/directory/connect', body);
      if (status.connected) onConnected();
      else setError(status.error ?? 'connection failed');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'connection failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto mt-6 max-w-xl">
      <Panel brackets>
        <PanelHeader label="Directory" title="Connect to your domain" hint="Active Directory or Samba — uses an admin account to manage the domain" />
        <div className="flex flex-col gap-4 px-6 pb-6 pt-4">
          {/* AD / Samba choice */}
          <div className="grid grid-cols-2 gap-2">
            {([['ad', 'Active Directory', 'Windows Server'], ['samba', 'Samba', 'Linux domain']] as const).map(([m, label, sub]) => {
              const on = mode === m;
              return (
                <button
                  key={m}
                  onClick={() => setMode(m as DirectoryMode)}
                  className={cn('flex flex-col items-start gap-1 rounded-xl border px-4 py-3 text-left transition-colors', on ? 'border-accent/50 bg-[color-mix(in_oklch,var(--accent)_10%,transparent)]' : 'border-line hover:border-line-strong')}
                >
                  <span className={cn('flex items-center gap-2 text-sm font-medium', on ? 'text-accent' : 'text-text')}>
                    <Server size={15} /> {label}
                  </span>
                  <span className="text-xs text-faint">{sub}</span>
                </button>
              );
            })}
          </div>

          <Field label={mode === 'ad' ? 'Domain controller (Windows DC)' : 'Samba DC host'} hint="hostname or IP (optionally host:port)">
            <input value={host} onChange={(e) => setHost(e.target.value)} placeholder={mode === 'ad' ? 'dc01.corp.example.com  or  192.168.1.10' : 'samba.lan  or  192.168.1.10'} className={cls} />
          </Field>
          <Field label="Domain / realm" hint={mode === 'ad' ? 'your Active Directory domain (FQDN)' : 'the Samba domain'}>
            <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder={mode === 'ad' ? 'corp.example.com' : 'SAMBA.LAN'} className={cls} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Admin username" hint={mode === 'ad' ? 'AD admin' : 'Samba admin'}>
              <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder={mode === 'ad' ? 'Administrator  ·  DOMAIN\\admin  ·  admin@corp.example.com' : 'Administrator'} className={cls} />
            </Field>
            <Field label="Password">
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && connect()} placeholder="••••••••" className={cls} />
            </Field>
          </div>

          <div>
            <div className="label mb-1.5">Connection security</div>
            <div className="grid grid-cols-3 gap-2">
              {([['plain', 'Plain LDAP', ':389'], ['starttls', 'StartTLS', ':389'], ['ldaps', 'LDAPS', ':636']] as const).map(([s, lbl, port]) => {
                const on = security === s;
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSecurity(s as DirectorySecurity)}
                    className={cn('flex flex-col items-center gap-0.5 rounded-lg border px-2 py-2 text-xs transition-colors', on ? 'border-accent/50 bg-[color-mix(in_oklch,var(--accent)_10%,transparent)] text-accent' : 'border-line text-muted hover:text-text')}
                  >
                    <span className="flex items-center gap-1 font-medium">{s !== 'plain' && <Lock size={11} />} {lbl}</span>
                    <span className="text-[0.6rem] text-faint">{port}</span>
                  </button>
                );
              })}
            </div>
            <p className="mt-1.5 text-xs text-faint">
              Plain works everywhere for reading + managing. Changing passwords needs <span className="text-muted">StartTLS</span> or <span className="text-muted">LDAPS</span> — and the DC must have a certificate. If LDAPS gives <span className="font-mono text-warn">ECONNRESET</span>, the DC has no LDAPS certificate — use Plain or StartTLS instead.
            </p>
          </div>

          <label className="flex items-start gap-2.5 rounded-lg border border-line bg-[var(--bg-2)]/40 px-3 py-2.5 text-sm text-muted">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="mt-0.5 accent-[var(--accent)]" />
            <span>
              Stay signed in on this server
              <span className="mt-0.5 block text-xs text-faint">Credentials are encrypted at rest (AES-256-GCM) and the connection auto-restores after a restart — no re-login. Disconnect wipes them.</span>
            </span>
          </label>

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-danger/30 bg-[color-mix(in_oklch,var(--danger)_8%,transparent)] px-3 py-2 text-sm text-danger">
              <ShieldQuestion size={15} className="mt-0.5 shrink-0" /> {error}
            </div>
          )}

          <button
            onClick={connect}
            disabled={busy}
            className="flex items-center justify-center gap-2 rounded-xl border border-accent/50 bg-[color-mix(in_oklch,var(--accent)_16%,transparent)] px-4 py-2.5 text-sm font-medium text-accent disabled:opacity-50"
          >
            <Plug size={15} /> {busy ? 'connecting…' : 'Connect'}
          </button>
          <p className="text-center text-xs text-faint">Credentials are held in memory only and never written to disk — you’ll be asked again if the session drops.</p>
        </div>
      </Panel>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="label">{label}{hint && <span className="ml-2 lowercase tracking-normal text-faint">· {hint}</span>}</span>
      {children}
    </label>
  );
}
