'use client';

/**
 * Client for the real DNS resolver control surface (`/api/dns/*`). Unlike the
 * rest of the GUI (which can run on the demo simulator), the DNS tab always
 * talks to the live control plane, so it targets the API URL directly and
 * defaults to localhost:8787 when none is configured.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiResponse } from '@nexrelm/types';
import { authHeaders, onUnauthorized } from './auth';

export const DNS_API = (process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '') || 'http://localhost:8787');

async function unwrap<T>(res: Response): Promise<T> {
  if (res.status === 401) {
    onUnauthorized();
    throw new Error('unauthorized');
  }
  const body = (await res.json()) as ApiResponse<T>;
  if (!body.ok || body.data == null) throw new Error(body.error ?? 'request failed');
  return body.data;
}

export async function dnsGet<T>(path: string): Promise<T> {
  return unwrap<T>(await fetch(`${DNS_API}${path}`, { cache: 'no-store', headers: authHeaders() }));
}

export async function dnsSend<T>(method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
  return unwrap<T>(
    await fetch(`${DNS_API}${path}`, {
      method,
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...authHeaders() },
      body: body ? JSON.stringify(body) : undefined,
    }),
  );
}

export interface UseDns<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  refresh: () => void;
}

/** Fetch `path` once and (optionally) poll it. `deps` re-fetch on change. */
export function useDns<T>(path: string | null, intervalMs = 0, deps: unknown[] = []): UseDns<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const tick = useRef(0);

  const load = useCallback(async () => {
    if (!path) return;
    const id = ++tick.current;
    try {
      const d = await dnsGet<T>(path);
      if (id === tick.current) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      if (id === tick.current) setError(e instanceof Error ? e.message : 'unreachable');
    } finally {
      if (id === tick.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);

  useEffect(() => {
    setLoading(true);
    void load();
    if (intervalMs > 0) {
      const t = setInterval(() => void load(), intervalMs);
      return () => clearInterval(t);
    }
    return undefined;
  }, [load, intervalMs]);

  return { data, error, loading, refresh: load };
}
