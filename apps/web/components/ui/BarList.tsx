import { cn } from '@/lib/format';
import { num } from '@/lib/format';

export interface BarItem {
  label: string;
  value: number;
  sub?: string;
}

interface BarListProps {
  items: BarItem[];
  color?: string;
  className?: string;
  max?: number;
  empty?: string;
}

/** A ranked "top N" list with proportional bars — the Pi-hole top-domains look. */
export function BarList({ items, color = 'var(--accent)', className, max, empty = 'no data yet' }: BarListProps) {
  const peak = max ?? Math.max(1, ...items.map((i) => i.value));
  if (items.length === 0) {
    return <div className="px-1 py-6 text-center text-xs text-faint">{empty}</div>;
  }
  return (
    <ul className={cn('flex flex-col gap-1.5', className)}>
      {items.map((it, i) => (
        <li key={i} className="relative overflow-hidden rounded-md">
          <div
            className="absolute inset-y-0 left-0 rounded-md opacity-[0.16] transition-[width] duration-500"
            style={{ width: `${(it.value / peak) * 100}%`, background: color }}
          />
          <div className="relative flex items-center justify-between gap-3 px-2.5 py-1.5">
            <span className="min-w-0 truncate font-mono text-xs text-text/90" title={it.label}>
              {it.label}
              {it.sub && <span className="ml-2 text-faint">{it.sub}</span>}
            </span>
            <span className="stat shrink-0 text-xs text-muted">{num(it.value)}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}
