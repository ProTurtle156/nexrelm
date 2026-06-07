import { cn } from '@/lib/format';

/** Centered "booting" indicator shown while the snapshot loads. */
export function Loading({ label = 'initializing', className }: { label?: string; className?: string }) {
  return (
    <div className={cn('grid min-h-[60vh] place-items-center', className)}>
      <div className="flex flex-col items-center gap-4">
        <div className="relative h-12 w-12">
          <span className="absolute inset-0 animate-ping rounded-full border border-accent/40" />
          <span className="absolute inset-2 rounded-full border border-accent/70" />
          <span className="absolute inset-[18px] rounded-full bg-accent shadow-glow" />
        </div>
        <span className="label">{label}</span>
      </div>
    </div>
  );
}

/** A simple panel skeleton block. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-xl bg-line-strong/40', className)} />;
}
