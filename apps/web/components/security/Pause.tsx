'use client';

import { useState } from 'react';
import { ShieldCheck, ShieldOff, ChevronDown, Play } from 'lucide-react';
import type { SecurityPauseState } from '@nexrelm/types';
import { useSec, secSend } from '@/lib/security';
import { StatusDot } from '@/components/ui/StatusDot';

const DURATIONS = [
  { label: '30 seconds', seconds: 30 },
  { label: '5 minutes', seconds: 300 },
  { label: '30 minutes', seconds: 1800 },
  { label: '1 hour', seconds: 3600 },
  { label: 'Indefinitely', seconds: 0 },
];

function countdown(until: string | null | undefined): string {
  if (!until) return '';
  const ms = new Date(until).getTime() - Date.now();
  if (ms <= 0) return '';
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

export function Pause() {
  const { data, refresh } = useSec<SecurityPauseState>('/api/security/pause', 1000);
  const [open, setOpen] = useState(false);
  const paused = data?.active ?? false;
  const left = countdown(data?.until);

  async function pause(seconds: number) {
    await secSend('POST', '/api/security/pause', { action: 'pause', seconds });
    setOpen(false);
    refresh();
  }
  async function resume() {
    await secSend('POST', '/api/security/pause', { action: 'resume' });
    refresh();
  }

  if (paused) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-warn/40 bg-[color-mix(in_oklch,var(--warn)_10%,transparent)] px-4 py-2">
        <ShieldOff size={16} className="text-warn" />
        <div className="text-sm">
          <span className="font-medium text-warn">Monitoring paused</span>
          {left && <span className="ml-2 stat text-xs text-muted">{left} left</span>}
          {!data?.until && <span className="ml-2 text-xs text-faint">indefinitely</span>}
        </div>
        <button onClick={resume} className="ml-1 flex items-center gap-1.5 rounded-lg border border-good/40 bg-[color-mix(in_oklch,var(--good)_12%,transparent)] px-3 py-1.5 text-xs font-medium text-good">
          <Play size={13} /> Resume
        </button>
      </div>
    );
  }

  return (
    <div className="relative flex items-center gap-2.5">
      <span className="flex items-center gap-2 text-sm text-muted">
        <StatusDot color="var(--good)" /> <ShieldCheck size={15} className="text-good" /> Monitoring active
      </span>
      <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs text-muted hover:text-text">
        Pause <ChevronDown size={13} className={open ? 'rotate-180' : ''} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-1 w-44 rounded-lg border border-line bg-[var(--bg-1)] p-1.5 shadow-xl">
            <p className="px-2 py-1 text-[0.65rem] uppercase tracking-wide text-faint">Pause detection for</p>
            {DURATIONS.map((d) => (
              <button key={d.seconds} onClick={() => pause(d.seconds)} className="block w-full rounded px-2 py-1.5 text-left text-sm text-text hover:bg-[var(--bg-2)]">
                {d.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
