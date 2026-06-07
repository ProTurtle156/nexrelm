'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Hexagon } from 'lucide-react';
import { NAV } from '@/lib/nav';
import { cn } from '@/lib/format';
import { useNexrelm } from '@/components/providers/NexrelmProvider';
import { StatusDot } from '@/components/ui/StatusDot';

function isActive(pathname: string, href: string): boolean {
  return href === '/' ? pathname === '/' : pathname.startsWith(href);
}

export function Sidebar() {
  const pathname = usePathname();
  const { status, mode } = useNexrelm();
  const dot = status === 'live' ? 'var(--good)' : status === 'demo' ? 'var(--accent)' : 'var(--warn)';

  return (
    <aside className="sticky top-0 z-20 flex h-screen w-16 flex-col border-r border-line bg-[var(--bg-2)]/70 backdrop-blur-xl lg:w-60">
      {/* brand */}
      <Link href="/" className="flex h-16 items-center gap-3 px-4 lg:px-5">
        <span className="relative grid h-8 w-8 shrink-0 place-items-center">
          <Hexagon className="h-8 w-8 text-accent" strokeWidth={1.4} />
          <span className="absolute h-2 w-2 rounded-full bg-accent shadow-glow" />
        </span>
        <span className="hidden flex-col leading-none lg:flex">
          <span className="font-mono text-sm font-semibold tracking-[0.22em] text-text">NEXRELM</span>
          <span className="mt-1 text-[0.6rem] tracking-wide text-faint">one nexus · every realm</span>
        </span>
      </Link>

      {/* nav */}
      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-2 py-3 no-scrollbar lg:px-3">
        {NAV.map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              title={item.label}
              className={cn(
                'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors',
                active ? 'text-text' : 'text-muted hover:text-text',
              )}
            >
              {active && (
                <span className="absolute inset-0 -z-10 rounded-xl border border-line-strong bg-[color-mix(in_oklch,var(--accent)_12%,transparent)]" />
              )}
              <span
                className={cn(
                  'absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full transition-all',
                  active ? 'bg-accent shadow-glow' : 'bg-transparent',
                )}
              />
              <Icon size={18} className={cn('shrink-0', active && 'text-accent')} strokeWidth={active ? 2.1 : 1.7} />
              <span className="hidden flex-1 truncate lg:block">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* mode footer */}
      <div className="border-t border-line px-3 py-3 lg:px-4">
        <div className="flex items-center gap-2.5">
          <StatusDot color={dot} />
          <div className="hidden min-w-0 lg:block">
            <div className="font-mono text-[0.7rem] uppercase tracking-wider text-text">
              {status === 'loading' ? 'connecting' : mode}
            </div>
            <div className="truncate text-[0.62rem] text-faint">
              {mode === 'live' ? 'control plane' : 'in-browser simulator'}
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
