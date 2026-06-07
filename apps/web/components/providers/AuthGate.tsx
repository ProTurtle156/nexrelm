'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { AuthMe, AuthStatus } from '@nexrelm/types';
import { dnsGet } from '@/lib/dns';
import { getToken } from '@/lib/auth';
import { Loading } from '@/components/ui/Loading';

/**
 * First-run + session routing:
 *   not initialized        → /setup (the install wizard)
 *   initialized, no session → /login
 *   password change pending → /login (its forced-change step)
 * /login and /setup render without these checks (they ARE the flow).
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isPublic = pathname === '/login' || pathname === '/setup';
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    setReady(false);
    (async () => {
      try {
        const status = await dnsGet<AuthStatus>('/api/auth/status'); // public
        if (!alive) return;
        if (!status.initialized) {
          if (pathname === '/setup') setReady(true);
          else router.replace('/setup');
          return;
        }
        if (pathname === '/setup') {
          router.replace('/login'); // wizard already done
          return;
        }
        if (pathname === '/login') {
          setReady(true);
          return;
        }
        if (!getToken()) {
          router.replace('/login');
          return;
        }
        const me = await dnsGet<AuthMe>('/api/auth/me'); // 401 → onUnauthorized redirects
        if (!alive) return;
        if (me.mustChangePassword) {
          router.replace('/login'); // its change-password step takes over
          return;
        }
        setReady(true);
      } catch {
        if (alive && !isPublic) router.replace('/login');
        else if (alive) setReady(true);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  if (!ready) {
    return (
      <div className="grid min-h-screen place-items-center">
        <Loading label="authenticating" />
      </div>
    );
  }
  return <>{children}</>;
}
