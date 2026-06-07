import type { LogLine, LogLevel } from '@nexrelm/types';
import { hms } from '@/lib/format';

const LEVEL_COLOR: Record<LogLevel, string> = {
  debug: 'var(--faint)',
  info: 'var(--accent-dim)',
  warn: 'var(--warn)',
  error: 'var(--danger)',
};

interface LogStreamProps {
  logs: LogLine[];
  max?: number;
  height?: number | string;
}

/** A live console tail. Newest line first, monospace, color-coded by level. */
export function LogStream({ logs, max, height = 320 }: LogStreamProps) {
  const rows = max ? logs.slice(0, max) : logs;
  if (rows.length === 0) {
    return <div className="grid place-items-center px-4 py-10 text-sm text-faint">waiting for log lines…</div>;
  }
  return (
    <div className="overflow-y-auto px-4 pb-3 font-mono text-[0.72rem] leading-relaxed no-scrollbar" style={{ height }}>
      {rows.map((l) => (
        <div key={l.id} className="flex items-start gap-3 border-b border-line/40 py-1.5 last:border-0">
          <span className="shrink-0 tabular-nums text-faint">{hms(l.ts)}</span>
          <span className="w-14 shrink-0 uppercase tracking-wider" style={{ color: LEVEL_COLOR[l.level] }}>
            {l.level}
          </span>
          <span className="w-16 shrink-0 text-muted">{l.stream}</span>
          <span className="min-w-0 flex-1 text-text/90">{l.msg}</span>
        </div>
      ))}
    </div>
  );
}
