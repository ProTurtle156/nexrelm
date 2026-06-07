'use client';

import { useMemo, useState } from 'react';
import { useDns } from '@/lib/dns';
import { Panel, PanelHeader } from '@/components/ui/Panel';
import { LogStream } from '@/components/panels/LogStream';
import { cn } from '@/lib/format';
import type { LogLevel, LogLine, LogStream as Stream } from '@nexrelm/types';

const STREAMS: Array<Stream | 'all'> = ['all', 'system', 'dns', 'dhcp', 'directory', 'virt', 'security'];
const LEVELS: Array<LogLevel | 'all'> = ['all', 'debug', 'info', 'warn', 'error'];

export default function LogsPage() {
  // poll the real unified log buffer (every module writes here) — history + live
  const { data } = useDns<LogLine[]>('/api/logs?limit=800', 2000);
  const logs = data ?? [];
  const [stream, setStream] = useState<Stream | 'all'>('all');
  const [level, setLevel] = useState<LogLevel | 'all'>('all');

  const filtered = useMemo(
    () => logs.filter((l) => (stream === 'all' || l.stream === stream) && (level === 'all' || l.level === level)),
    [logs, stream, level],
  );

  return (
    <Panel scanlines>
      <PanelHeader
        label="Console"
        title="Live event stream"
        hint={`${filtered.length} lines · all modules · newest first`}
        right={<span className="font-mono text-[0.66rem] text-faint">tail -f /var/log/nexrelm</span>}
      />
      <div className="flex flex-wrap items-center gap-2 px-5 py-3">
        <span className="label mr-1">stream</span>
        {STREAMS.map((s) => (
          <Chip key={s} active={stream === s} onClick={() => setStream(s)}>
            {s}
          </Chip>
        ))}
        <span className="label ml-3 mr-1">level</span>
        {LEVELS.map((l) => (
          <Chip key={l} active={level === l} onClick={() => setLevel(l)}>
            {l}
          </Chip>
        ))}
      </div>
      <div className="border-t border-line">
        <LogStream logs={filtered} height="calc(100vh - 320px)" />
      </div>
    </Panel>
  );
}

function Chip({ children, active, onClick }: { children: React.ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'rounded-full border px-3 py-1 font-mono text-[0.68rem] uppercase tracking-wider transition-colors',
        active
          ? 'border-accent/40 bg-[color-mix(in_oklch,var(--accent)_14%,transparent)] text-accent'
          : 'border-line text-muted hover:text-text',
      )}
    >
      {children}
    </button>
  );
}
