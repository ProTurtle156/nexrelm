import type { SecurityEvent } from '@nexrelm/types';
import { relTime } from '@/lib/format';
import { severityVar } from '@/lib/ui';
import { Badge } from '@/components/ui/Badge';

interface SecurityFeedProps {
  events: SecurityEvent[];
  max?: number;
  height?: number | string;
}

/** Reverse-chronological feed of security events with severity + action. */
export function SecurityFeed({ events, max, height = 320 }: SecurityFeedProps) {
  const rows = max ? events.slice(0, max) : events;
  if (rows.length === 0) {
    return <div className="grid place-items-center px-4 py-10 text-sm text-faint">no events</div>;
  }
  return (
    <div className="overflow-y-auto px-4 pb-3 no-scrollbar" style={{ height }}>
      {rows.map((e) => {
        const color = severityVar(e.severity);
        return (
          <div key={e.id} className="flex items-start gap-3 border-b border-line/40 py-2.5 last:border-0">
            <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Badge color={color}>{e.severity}</Badge>
                <span className="truncate text-[0.7rem] text-faint">{e.category}</span>
                <span className="ml-auto shrink-0 text-[0.66rem] text-faint">{relTime(e.ts)}</span>
              </div>
              <p className="mt-1 truncate text-sm text-text/90">{e.message}</p>
              <p className="mt-0.5 font-mono text-[0.66rem] text-faint">
                src {e.source} · <span style={{ color }}>{e.action}</span>
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
