import type { ReactNode } from 'react';
import { cn } from '@/lib/format';

interface StatProps {
  label: string;
  value: ReactNode;
  unit?: string;
  sub?: ReactNode;
  className?: string;
  accent?: string;
}

/** A labeled readout: tracked-out label over a big tabular-nums value. */
export function Stat({ label, value, unit, sub, className, accent }: StatProps) {
  return (
    <div className={cn('min-w-0', className)}>
      <div className="label">{label}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="stat text-2xl font-semibold" style={accent ? { color: accent } : undefined}>
          {value}
        </span>
        {unit && <span className="stat text-sm text-muted">{unit}</span>}
      </div>
      {sub && <div className="mt-0.5 truncate text-xs text-muted">{sub}</div>}
    </div>
  );
}
