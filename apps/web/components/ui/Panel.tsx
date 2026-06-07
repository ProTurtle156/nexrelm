import type { ReactNode } from 'react';
import { cn } from '@/lib/format';

interface PanelProps {
  children: ReactNode;
  className?: string;
  /** Render the corner-bracket "targeted" decoration. */
  brackets?: boolean;
  /** Optional faint scanline texture overlay. */
  scanlines?: boolean;
}

export function Panel({ children, className, brackets, scanlines }: PanelProps) {
  return (
    <section className={cn('panel relative overflow-hidden', brackets && 'brackets', className)}>
      {scanlines && <div className="scanlines pointer-events-none absolute inset-0 opacity-30" />}
      {children}
    </section>
  );
}

interface PanelHeaderProps {
  label: string;
  title?: string;
  hint?: ReactNode;
  right?: ReactNode;
  className?: string;
}

/** The standard panel masthead: tracked-out mono label + optional title + slot. */
export function PanelHeader({ label, title, hint, right, className }: PanelHeaderProps) {
  return (
    <header className={cn('flex items-start justify-between gap-4 px-5 pt-4', className)}>
      <div className="min-w-0">
        <div className="label">{label}</div>
        {title && <h2 className="mt-1 truncate text-[0.95rem] font-medium text-text">{title}</h2>}
        {hint && <div className="mt-0.5 text-xs text-muted">{hint}</div>}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </header>
  );
}
