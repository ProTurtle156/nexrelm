'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { AuthGate } from '@/components/providers/AuthGate';

/** Routes that render bare (no nav chrome): the install wizard + sign-in. */
const BARE = new Set(['/login', '/setup']);

/** The persistent chrome: nav rail + topbar wrapped around routed content. */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (BARE.has(pathname)) {
    return <AuthGate>{children}</AuthGate>;
  }
  return (
    <AuthGate>
      <div className="flex min-h-screen">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar />
          <main className="flex-1 px-4 py-5 sm:px-6 sm:py-6">
            <div className="mx-auto w-full max-w-[1500px] animate-rise-in">{children}</div>
          </main>
        </div>
      </div>
    </AuthGate>
  );
}
