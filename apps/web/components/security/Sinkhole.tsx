'use client';

import { useState } from 'react';
import { ShieldX, Power } from 'lucide-react';
import type { SinkholeState } from '@nexrelm/types';
import { useSec, secSend } from '@/lib/security';
import { num } from '@/lib/format';
import { Panel, PanelHeader } from '@/components/ui/Panel';

export function Sinkhole() {
  const { data, refresh } = useSec<SinkholeState>('/api/security/sinkhole', 5000);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    try {
      await secSend('POST', '/api/security/sinkhole', { enabled: !data?.enabled });
      refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel>
      <PanelHeader
        label="Sinkhole"
        title="Threat-intel DNS sinkhole"
        hint={data?.enabled ? `${num(data.domains)} domains · ${num(data.blocked)} sinkholed` : 'off — alert only'}
        right={
          <button onClick={toggle} disabled={busy} className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium disabled:opacity-50 ${data?.enabled ? 'border-good/40 text-good' : 'border-accent/40 bg-[color-mix(in_oklch,var(--accent)_14%,transparent)] text-accent'}`}>
            <ShieldX size={13} /> {data?.enabled ? 'On' : 'Enable'}
          </button>
        }
      />
      <div className="px-5 pb-5 pt-2">
        <p className="text-[0.66rem] text-faint">
          Because Nexrelm <span className="text-text">is</span> the resolver, it can block — not just alert. When on, every query to a known-bad domain on the threat-intel feeds is <span className="text-accent">sinkholed</span> (returned 0.0.0.0) instead of resolved. Allowlisted domains are never sinkholed.
        </p>
        {data?.enabled && (
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-line/60 px-3 py-2">
              <div className="stat text-xl font-semibold text-accent">{num(data.domains)}</div>
              <div className="text-[0.6rem] text-faint">bad domains loaded</div>
            </div>
            <div className="rounded-lg border border-line/60 px-3 py-2">
              <div className="stat text-xl font-semibold text-danger">{num(data.blocked)}</div>
              <div className="text-[0.6rem] text-faint">queries sinkholed</div>
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}
