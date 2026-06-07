import type { ReactNode } from 'react';
import { cn } from '@/lib/format';

interface BadgeProps {
  children: ReactNode;
  /** A token color used for text + tinted border/background. */
  color?: string;
  className?: string;
  mono?: boolean;
}

/** A compact tinted pill. `color` is a CSS token like `var(--good)`. */
export function Badge({ children, color = 'var(--faint)', className, mono = true }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[0.68rem] font-medium leading-none',
        mono && 'font-mono uppercase tracking-wider',
        className,
      )}
      style={{
        color,
        borderColor: 'color-mix(in oklch, ' + 'currentColor 38%, transparent)',
        background: 'color-mix(in oklch, ' + 'currentColor 12%, transparent)',
      }}
    >
      {children}
    </span>
  );
}
