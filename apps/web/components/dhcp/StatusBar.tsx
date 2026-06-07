'use client';

import { useState } from 'react';
import { Power, AlertTriangle, Server } from 'lucide-react';
import type { DhcpServerStatus } from '@nexrelm/types';
import { dhcpSend } from '@/lib/dhcp';
import { StatusDot } from '@/components/ui/StatusDot';

interface StatusBarProps {
  status: DhcpServerStatus | null;
  error: string | null;
  onChange: () => void;
}

export function StatusBar({ status, error, onChange }: StatusBarProps) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function set(enabled: boolean) {
    setBusy(true);
    setConfirming(false);
    try {
      await dhcpSend('POST', '/api/dhcp/control', { action: enabled ? 'start' : 'stop' });
      onChange();
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <div className="panel flex items-center gap-3 px-5 py-3.5">
        <AlertTriangle size={18} className="text-warn" />
        <div className="text-sm">
          <div className="font-medium text-text">Control plane unreachable</div>
          <div className="text-xs text-faint">{error}</div>
        </div>
      </div>
    );
  }

  const enabled = status?.enabled ?? false;
  const running = status?.running ?? false;

  return (
    <div className="flex flex-col gap-3">
      <div className="panel flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <StatusDot color={running ? 'var(--good)' : enabled ? 'var(--warn)' : 'var(--faint)'} pulse={running} />
          <div>
            <div className="label">DHCP Server</div>
            <div className="stat text-sm text-text">{running ? `serving · ${status?.bind}` : enabled ? 'starting…' : 'stopped'}</div>
          </div>
        </div>
        {status?.message && (
          <div className="flex items-center gap-2 text-xs text-warn">
            <AlertTriangle size={13} /> {status.message}
          </div>
        )}
        <div className="ml-auto">
          {enabled ? (
            <button
              disabled={busy}
              onClick={() => set(false)}
              className="flex items-center gap-2 rounded-xl border border-danger/40 bg-[color-mix(in_oklch,var(--danger)_12%,transparent)] px-4 py-2 text-sm font-medium text-danger hover:bg-[color-mix(in_oklch,var(--danger)_20%,transparent)] disabled:opacity-50"
            >
              <Power size={15} /> Stop server
            </button>
          ) : (
            <button
              disabled={busy}
              onClick={() => setConfirming(true)}
              className="flex items-center gap-2 rounded-xl border border-good/40 bg-[color-mix(in_oklch,var(--good)_12%,transparent)] px-4 py-2 text-sm font-medium text-good hover:bg-[color-mix(in_oklch,var(--good)_20%,transparent)] disabled:opacity-50"
            >
              <Power size={15} /> Start server
            </button>
          )}
        </div>
      </div>

      {confirming && (
        <div className="panel flex flex-col gap-3 border-warn/40 px-5 py-4" style={{ borderColor: 'color-mix(in oklch, var(--warn) 40%, transparent)' }}>
          <div className="flex items-start gap-3">
            <AlertTriangle size={20} className="mt-0.5 shrink-0 text-warn" />
            <div className="text-sm">
              <div className="font-medium text-text">Disable your router's DHCP first</div>
              <p className="mt-1 text-muted">
                Two DHCP servers on one network hand out conflicting addresses and break connectivity. Turn off DHCP on your router
                (and open UDP <span className="font-mono text-accent">67</span> in the firewall) before starting this. Clients will get
                their gateway, DNS and lease from Nexrelm.
              </p>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setConfirming(false)} className="rounded-lg border border-line px-4 py-2 text-sm text-muted hover:text-text">
              Cancel
            </button>
            <button onClick={() => set(true)} disabled={busy} className="flex items-center gap-2 rounded-lg border border-warn/50 bg-[color-mix(in_oklch,var(--warn)_16%,transparent)] px-4 py-2 text-sm font-medium text-warn disabled:opacity-50">
              <Server size={14} /> I understand — start the DHCP server
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
