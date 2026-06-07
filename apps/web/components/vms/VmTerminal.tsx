'use client';

import { useEffect, useRef, useState } from 'react';
import { TerminalSquare, RotateCw, ChevronDown } from 'lucide-react';
import '@xterm/xterm/css/xterm.css';
import type { Terminal } from '@xterm/xterm';
import type { VmMachine } from '@nexrelm/types';
import { useVm, VMS_API } from '@/lib/vms';
import { getToken } from '@/lib/auth';
import { Panel, PanelHeader } from '@/components/ui/Panel';
import { StatusDot } from '@/components/ui/StatusDot';

type Phase = 'idle' | 'connecting' | 'open' | 'closed';

/**
 * A real terminal into a registered VM: an xterm wired to the control-plane's
 * SSH bridge over a WebSocket. The backend authenticates with the VM's saved
 * credentials, so commands run with that user's privileges.
 */
export function VmTerminal({ initialVmId }: { initialVmId?: string | null }) {
  const { data: vms } = useVm<VmMachine[]>('/api/vms', 0);
  const [vmId, setVmId] = useState<string | null>(initialVmId ?? null);
  const mountRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');

  useEffect(() => {
    if (initialVmId) setVmId(initialVmId);
  }, [initialVmId]);

  // pick the first VM if none chosen yet
  useEffect(() => {
    if (!vmId && vms?.length) setVmId(vms[0]!.id);
  }, [vms, vmId]);

  const current = vms?.find((v) => v.id === vmId) ?? null;

  function teardown() {
    cleanupRef.current?.();
    cleanupRef.current = null;
    wsRef.current?.close();
    wsRef.current = null;
    termRef.current?.dispose();
    termRef.current = null;
  }

  async function connect(id: string) {
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

    const ws = new WebSocket(VMS_API.replace(/^http/, 'ws') + '/api/vms/shell?token=' + encodeURIComponent(getToken() ?? ''));
    wsRef.current = ws;
    ws.onopen = () => {
      setPhase('open');
      ws.send(JSON.stringify({ type: 'auth', id, cols: term.cols, rows: term.rows }));
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
        /* torn down */
      }
    };
    window.addEventListener('resize', onResize);
    cleanupRef.current = () => {
      dataSub.dispose();
      window.removeEventListener('resize', onResize);
    };
  }

  // connect whenever the selected VM changes
  useEffect(() => {
    if (vmId) void connect(vmId);
    return teardown;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vmId]);

  if (!vms?.length) {
    return (
      <Panel>
        <PanelHeader label="Terminal" title="VM terminal" hint="no VMs registered yet" />
        <div className="px-5 py-10 text-center text-sm text-faint">Add a VM in the VMs tab, then open a terminal into it here.</div>
      </Panel>
    );
  }

  return (
    <Panel brackets scanlines>
      <PanelHeader
        label="Terminal"
        title={current ? `${current.username}@${current.name}` : 'VM terminal'}
        hint={current ? `${current.host}:${current.port} · ${phase === 'open' ? 'live' : phase}` : 'pick a VM'}
        right={
          <div className="flex items-center gap-1.5">
            <div className="relative">
              <select value={vmId ?? ''} onChange={(e) => setVmId(e.target.value)} className="appearance-none rounded-lg border border-line bg-[var(--bg-2)] py-1.5 pl-3 pr-7 text-xs text-text outline-none focus:border-accent/50">
                {vms.map((v) => (
                  <option key={v.id} value={v.id}>{v.name} ({v.host})</option>
                ))}
              </select>
              <ChevronDown size={13} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-faint" />
            </div>
            <button onClick={() => vmId && void connect(vmId)} className="flex items-center gap-1.5 rounded-lg border border-accent/40 bg-[color-mix(in_oklch,var(--accent)_14%,transparent)] px-2.5 py-1.5 text-xs font-medium text-accent" title="reconnect">
              <RotateCw size={13} /> Reconnect
            </button>
            <TerminalSquare size={16} className="text-accent" />
          </div>
        }
      />
      <div className="flex items-center gap-2 border-b border-line px-5 py-2 text-xs text-muted">
        <StatusDot color={phase === 'open' ? 'var(--good)' : phase === 'connecting' ? 'var(--warn)' : 'var(--faint)'} pulse={phase === 'open'} />
        commands run as <span className="font-mono text-text">{current?.username}</span> with that account's privileges
      </div>
      <div ref={mountRef} className="px-3 py-2" style={{ height: 'calc(100vh - 360px)', minHeight: 300 }} />
    </Panel>
  );
}
