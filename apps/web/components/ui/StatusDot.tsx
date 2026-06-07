import { cn } from '@/lib/format';

interface StatusDotProps {
  color: string;
  /** Pulse for "live / active" states. */
  pulse?: boolean;
  size?: number;
  className?: string;
}

/** A glowing status dot — the heartbeat indicator used across the GUI. */
export function StatusDot({ color, pulse = true, size = 8, className }: StatusDotProps) {
  return (
    <span
      className={cn('relative inline-flex shrink-0', className)}
      style={{ width: size, height: size }}
    >
      {pulse && (
        <span
          className="absolute inset-0 animate-pulse-dot rounded-full"
          style={{ background: color, filter: 'blur(3px)', opacity: 0.7 }}
        />
      )}
      <span
        className="relative rounded-full"
        style={{ width: size, height: size, background: color, boxShadow: `0 0 8px ${color}` }}
      />
    </span>
  );
}
