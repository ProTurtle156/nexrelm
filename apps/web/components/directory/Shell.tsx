'use client';

import { useEffect, useRef, useState } from 'react';
import { TerminalSquare, RotateCw, SlidersHorizontal, Plug } from 'lucide-react';
import '@xterm/xterm/css/xterm.css';
import type { Terminal } from '@xterm/xterm';
import { DIR_API } from '@/lib/directory';
import { getToken } from '@/lib/auth';
import { Panel, PanelHeader } from '@/components/ui/Panel';

type Phase = 'idle' | 'connecting' | 'open' | 'closed';

/**
 * A real interactive shell: an xterm terminal wired to the control-plane's SSH
 * bridge over a WebSocket. Auto-connects to the connected DC using the bound
 * admin credentials, dropping the operator straight into the remote prompt.
 */
export function Shell({ host, username }: { host?: string; username?: string }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  const [phase, setPhase] = useState<Phase>('idle');
  const [showTarget, setShowTarget] = useState(false);
  const [sshHost, setSshHost] = useState(host ?? '');
  const [port, setPort] = useState('22');
  const [user, setUser] = useState(username ?? 'Administrator');
  const [password, setPassword] = useState('');
  const [useDirPw, setUseDirPw] = useState(true);

  function teardown() {
    cleanupRef.current?.();
    cleanupRef.current = null;
    wsRef.current?.close();
    wsRef.current = null;
    termRef.current?.dispose();
    termRef.current = null;
  }

  async function connect() {
    teardown();
    setPhase('connecting');

    const { Terminal } = await import('@xterm/xterm');
    const { FitAddon } = await import('@xterm/addon-fit');
    if (!mountRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      theme: { background: '#070b11', foreground: '#cbd5e1', cursor: '#7dd3fc', selectionBackground: '#1e3a5f' },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(mountRef.current);
    fit.fit();
    termRef.current = term;

    const wsUrl = DIR_API.replace(/^http/, 'ws') + '/api/directory/shell?token=' + encodeURIComponent(getToken() ?? '');
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setPhase('open');
      ws.send(
        JSON.stringify({
          type: 'auth',
          host: sshHost.trim(),
          port: Number(port) || 22,
          username: user.trim(),
          password,
          useDirectoryPassword: useDirPw,
          cols: term.cols,
          rows: term.rows,
        }),
      );
      term.focus();
    };
    ws.onmessage = (e) => {
      if (typeof e.data === 'string') term.write(e.data);
    };
    ws.onclose = () => {
      setPhase('closed');
      term.write('\r\n\x1b[2m[nexrelm] disconnected.\x1b[0m\r\n');
    };
    ws.onerror = () => term.write('\r\n\x1b[31m[nexrelm] websocket error — is the control plane running?\x1b[0m\r\n');

    const dataSub = term.onData((d) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'data', data: d }));
    });
    const onResize = () => {
      try {
        fit.fit();
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      } catch {
        /* terminal torn down */
      }
    };
    window.addEventListener('resize', onResize);
    cleanupRef.current = () => {
      dataSub.dispose();
      window.removeEventListener('resize', onResize);
    };
  }

  // auto-connect on first mount (drop straight into the prompt)
  useEffect(() => {
    void connect();
    return teardown;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const statusText =
    phase === 'open' ? `live · ${user}@${sshHost || 'dc'}` : phase === 'connecting' ? 'connecting…' : phase === 'closed' ? 'session closed' : 'idle';

  return (
    <Panel brackets scanlines>
      <PanelHeader
        label="Shell"
        title="Interactive domain shell"
        hint={`SSH to the controller · ${statusText}`}
        right={
          <div className="flex items-center gap-1.5">
            <button onClick={() => setShowTarget((v) => !v)} className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs text-muted hover:text-text" title="change target">
              <SlidersHorizontal size={13} /> Target
            </button>
            <button onClick={() => void connect()} className="flex items-center gap-1.5 rounded-lg border border-accent/40 bg-[color-mix(in_oklch,var(--accent)_14%,transparent)] px-2.5 py-1.5 text-xs font-medium text-accent" title="reconnect">
              <RotateCw size={13} /> Reconnect
            </button>
            <TerminalSquare size={16} className="text-accent" />
          </div>
        }
      />

      {showTarget && (
        <div className="grid grid-cols-2 gap-3 border-b border-line bg-[var(--bg-2)]/40 px-5 py-4 sm:grid-cols-4">
          <Labeled label="SSH host" cls="col-span-2 sm:col-span-2">
            <input value={sshHost} onChange={(e) => setSshHost(e.target.value)} placeholder="dc01 or 192.168.1.10" className={inputCls} />
          </Labeled>
          <Labeled label="Port">
            <input value={port} onChange={(e) => setPort(e.target.value)} className={inputCls} />
          </Labeled>
          <Labeled label="Username">
            <input value={user} onChange={(e) => setUser(e.target.value)} placeholder="Administrator" className={inputCls} />
          </Labeled>
          <Labeled label="Password" cls="col-span-2">
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={useDirPw} placeholder={useDirPw ? 'using directory password' : 'SSH password'} className={inputCls + (useDirPw ? ' opacity-50' : '')} />
          </Labeled>
          <label className="col-span-2 flex items-center gap-2 self-end text-xs text-muted">
            <input type="checkbox" checked={useDirPw} onChange={(e) => setUseDirPw(e.target.checked)} className="accent-[var(--accent)]" />
            Use my directory admin password (kept server-side)
          </label>
          <div className="col-span-2 flex items-end justify-end sm:col-span-4">
            <button onClick={() => { setShowTarget(false); void connect(); }} className="flex items-center gap-1.5 rounded-lg border border-accent/50 bg-[color-mix(in_oklch,var(--accent)_16%,transparent)] px-4 py-2 text-sm font-medium text-accent">
              <Plug size={14} /> Connect
            </button>
          </div>
        </div>
      )}

      <div ref={mountRef} className="px-3 py-2" style={{ height: 'calc(100vh - 360px)', minHeight: 300 }} />
    </Panel>
  );
}

const inputCls = 'w-full rounded-lg border border-line bg-[var(--bg-2)] px-3 py-2 font-mono text-xs text-text outline-none placeholder:text-faint focus:border-accent/50';

function Labeled({ label, cls, children }: { label: string; cls?: string; children: React.ReactNode }) {
  return (
    <label className={`flex flex-col gap-1 ${cls ?? ''}`}>
      <span className="label">{label}</span>
      {children}
    </label>
  );
}
