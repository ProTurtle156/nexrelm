import { cn } from '@/lib/format';

interface UsageBarProps {
  /** 0..1 fill ratio. */
  ratio: number;
  color?: string;
  className?: string;
  height?: number;
}

/** A thin track + animated fill. Color shifts to warn/danger as it fills. */
export function UsageBar({ ratio, color, className, height = 6 }: UsageBarProps) {
  const r = Math.max(0, Math.min(1, ratio));
  const auto = r > 0.9 ? 'var(--danger)' : r > 0.75 ? 'var(--warn)' : 'var(--accent)';
  const fill = color ?? auto;
  return (
    <div
      className={cn('w-full overflow-hidden rounded-full', className)}
      style={{ height, background: 'var(--line-strong)' }}
    >
      <div
        className="h-full rounded-full transition-[width] duration-700 ease-out"
        style={{ width: `${r * 100}%`, background: fill, boxShadow: `0 0 10px ${fill}` }}
      />
    </div>
  );
}
