import { cn } from '@/lib/format';

export interface Slice {
  label: string;
  value: number;
}

// distinct categorical hues (theme-aware) so legend entries never collide
const PALETTE = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', 'var(--chart-6)', 'var(--faint)'];

interface PieChartProps {
  data: Slice[];
  size?: number;
  thickness?: number;
  className?: string;
}

/** A donut chart with an inline legend. Dependency-free SVG. */
export function PieChart({ data, size = 150, thickness = 22, className }: PieChartProps) {
  const total = data.reduce((a, s) => a + s.value, 0);
  const r = (size - thickness) / 2;
  const c = size / 2;
  const circ = 2 * Math.PI * r;

  let offset = 0;
  const arcs = total
    ? data.map((s, i) => {
        const frac = s.value / total;
        const seg = { color: PALETTE[i % PALETTE.length]!, dash: frac * circ, off: offset, label: s.label, value: s.value, pct: frac };
        offset += frac * circ;
        return seg;
      })
    : [];

  return (
    <div className={cn('flex items-center gap-5', className)}>
      <svg width={size} height={size} className="-rotate-90 shrink-0">
        <circle cx={c} cy={c} r={r} fill="none" stroke="var(--line-strong)" strokeWidth={thickness} />
        {arcs.map((a, i) => (
          <circle
            key={i}
            cx={c}
            cy={c}
            r={r}
            fill="none"
            stroke={a.color}
            strokeWidth={thickness}
            strokeDasharray={`${a.dash} ${circ - a.dash}`}
            strokeDashoffset={-a.off}
            style={{ transition: 'stroke-dasharray 0.6s, stroke-dashoffset 0.6s' }}
          />
        ))}
      </svg>
      <ul className="flex min-w-0 flex-1 flex-col gap-1.5">
        {arcs.length === 0 && <li className="text-xs text-faint">no data yet</li>}
        {arcs.slice(0, 7).map((a, i) => (
          <li key={i} className="flex items-center gap-2 text-xs">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: a.color }} />
            <span className="min-w-0 flex-1 truncate text-muted">{a.label}</span>
            <span className="stat shrink-0 text-text">{Math.round(a.pct * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
