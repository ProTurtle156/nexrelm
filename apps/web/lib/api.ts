/**
 * Data client. One surface, two backends:
 *  - LIVE  — when NEXT_PUBLIC_API_URL is set, talk to the control plane (REST + WS)
 *  - DEMO  — otherwise, drive everything from the in-browser simulator (lib/mock)
 */
import type {
  ApiResponse,
  DashboardSummary,
  DhcpState,
  DirectoryState,
  DnsState,
  LiveEvent,
  SecurityState,
  Topology,
  VirtState,
} from '@nexrelm/types';
import { mockSnapshot, mockSubscribe } from './mock';
import { authHeaders, getToken, onUnauthorized } from './auth';

export interface Snapshot {
  dashboard: DashboardSummary;
  topology: Topology;
  dns: DnsState;
  dhcp: DhcpState;
  directory: DirectoryState;
  virt: VirtState;
  security: SecurityState;
}

export type Mode = 'live' | 'demo';
export type VmAction = 'start' | 'stop' | 'pause' | 'resume';

const API = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '');
const WS_URL = process.env.NEXT_PUBLIC_WS_URL;

export const CONFIGURED_MODE: Mode = API ? 'live' : 'demo';

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { cache: 'no-store', headers: authHeaders() });
  if (res.status === 401) {
    onUnauthorized();
    throw new Error('unauthorized');
  }
  const body = (await res.json()) as ApiResponse<T>;
  if (!body.ok || body.data == null) throw new Error(body.error ?? 'request failed');
  return body.data;
}

/** Fetch the full initial snapshot. Falls back to demo data if LIVE is unreachable. */
export async function bootstrap(): Promise<{ snapshot: Snapshot; mode: Mode }> {
  if (!API) return { snapshot: mockSnapshot(), mode: 'demo' };
  try {
    const [dashboard, topology, dns, dhcp, directory, virt, security] = await Promise.all([
      getJson<DashboardSummary>('/api/dashboard'),
      getJson<Topology>('/api/topology'),
      getJson<DnsState>('/api/dns'),
      getJson<DhcpState>('/api/dhcp'),
      getJson<DirectoryState>('/api/directory'),
      getJson<VirtState>('/api/virtualization'),
      getJson<SecurityState>('/api/security'),
    ]);
    return { snapshot: { dashboard, topology, dns, dhcp, directory, virt, security }, mode: 'live' };
  } catch {
    return { snapshot: mockSnapshot(), mode: 'demo' };
  }
}

/** Subscribe to the live delta stream. Returns an unsubscribe function. */
export function subscribe(onEvent: (e: LiveEvent) => void): () => void {
  if (!API) return mockSubscribe(onEvent);

  const base = WS_URL ?? `${API.replace(/^http/, 'ws')}/ws`;
  const token = getToken();
  const url = token ? `${base}?token=${encodeURIComponent(token)}` : base;
  let socket: WebSocket | null = null;
  let closed = false;
  let retry: ReturnType<typeof setTimeout> | null = null;

  const connect = (): void => {
    if (closed) return;
    try {
      socket = new WebSocket(url);
      socket.onmessage = (msg) => {
        try {
          onEvent(JSON.parse(msg.data as string) as LiveEvent);
        } catch {
          /* ignore malformed frame */
        }
      };
      socket.onclose = () => {
        if (!closed) retry = setTimeout(connect, 2000);
      };
      socket.onerror = () => socket?.close();
    } catch {
      retry = setTimeout(connect, 2000);
    }
  };

  connect();
  return () => {
    closed = true;
    if (retry) clearTimeout(retry);
    socket?.close();
  };
}

export async function vmAction(id: string, action: VmAction): Promise<void> {
  if (!API) return; // demo mode updates optimistically in the provider
  await fetch(`${API}/api/virtualization/vms/${id}/${action}`, { method: 'POST', headers: authHeaders() }).catch(() => undefined);
}

export async function toggleRule(id: string): Promise<void> {
  if (!API) return;
  await fetch(`${API}/api/security/rules/${id}/toggle`, { method: 'POST', headers: authHeaders() }).catch(() => undefined);
}
