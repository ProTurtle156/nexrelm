'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { LiveEvent, LogLine, SecurityEvent, VmState } from '@nexrelm/types';
import {
  bootstrap,
  subscribe,
  vmAction as apiVmAction,
  toggleRule as apiToggleRule,
  type Mode,
  type Snapshot,
  type VmAction,
} from '@/lib/api';

export type ConnStatus = 'loading' | 'live' | 'demo';

/** Rolling buffers of streamed metric points, keyed by metric name. */
type MetricBuffers = Record<string, number[]>;

const METRIC_CAP = 60;
const LOG_CAP = 240;
const ALERT_CAP = 40;

const VM_NEXT: Record<VmAction, VmState> = {
  start: 'running',
  stop: 'stopped',
  pause: 'paused',
  resume: 'running',
};

interface NexrelmValue {
  status: ConnStatus;
  mode: Mode;
  snapshot: Snapshot | null;
  metrics: MetricBuffers;
  logs: LogLine[];
  alerts: SecurityEvent[];
  /** Total live events folded in since boot — a cheap "is it alive" signal. */
  eventCount: number;
  runVmAction: (id: string, action: VmAction) => void;
  toggleRule: (id: string) => void;
}

const Ctx = createContext<NexrelmValue | null>(null);

export function NexrelmProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ConnStatus>('loading');
  const [mode, setMode] = useState<Mode>('demo');
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [metrics, setMetrics] = useState<MetricBuffers>({});
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [alerts, setAlerts] = useState<SecurityEvent[]>([]);
  const [eventCount, setEventCount] = useState(0);
  const ready = useRef(false);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    let active = true;

    void (async () => {
      const { snapshot: snap, mode: m } = await bootstrap();
      if (!active) return;
      setSnapshot(snap);
      setMode(m);
      setStatus(m);
      setAlerts(snap.security.events.slice(0, ALERT_CAP));
      ready.current = true;

      unsub = subscribe((ev) => fold(ev));
    })();

    function fold(ev: LiveEvent): void {
      setEventCount((c) => c + 1);
      switch (ev.kind) {
        case 'metric':
          setMetrics((prev) => {
            const buf = prev[ev.key] ? [...prev[ev.key]!, ev.point.v] : [ev.point.v];
            if (buf.length > METRIC_CAP) buf.shift();
            return { ...prev, [ev.key]: buf };
          });
          break;
        case 'log':
          setLogs((prev) => [ev.line, ...prev].slice(0, LOG_CAP));
          break;
        case 'alert':
          setAlerts((prev) => [ev.event, ...prev].slice(0, ALERT_CAP));
          setSnapshot((prev) =>
            prev
              ? {
                  ...prev,
                  security: { ...prev.security, events: [ev.event, ...prev.security.events].slice(0, 60) },
                }
              : prev,
          );
          break;
        case 'topology':
          setSnapshot((prev) => (prev ? { ...prev, topology: ev.topology } : prev));
          break;
        case 'lease':
          setSnapshot((prev) =>
            prev
              ? { ...prev, dhcp: { ...prev.dhcp, leases: [ev.lease, ...prev.dhcp.leases].slice(0, 64) } }
              : prev,
          );
          break;
        case 'module':
          setSnapshot((prev) =>
            prev
              ? {
                  ...prev,
                  dashboard: {
                    ...prev.dashboard,
                    modules: prev.dashboard.modules.map((mod) =>
                      mod.key === ev.status.key ? ev.status : mod,
                    ),
                  },
                }
              : prev,
          );
          break;
      }
    }

    return () => {
      active = false;
      unsub?.();
    };
  }, []);

  const runVmAction = useCallback((id: string, action: VmAction) => {
    // Optimistic local update so the button feels instant in both modes.
    setSnapshot((prev) => {
      if (!prev) return prev;
      const next = VM_NEXT[action];
      return {
        ...prev,
        virt: {
          ...prev.virt,
          vms: prev.virt.vms.map((vm) =>
            vm.id === id
              ? {
                  ...vm,
                  state: next,
                  cpuPct: next === 'running' ? Math.max(vm.cpuPct, 8) : 0,
                  memPct: next === 'running' ? Math.max(vm.memPct, 24) : 0,
                  uptimeSec: next === 'stopped' ? 0 : vm.uptimeSec,
                }
              : vm,
          ),
        },
      };
    });
    void apiVmAction(id, action);
  }, []);

  const toggleRule = useCallback((id: string) => {
    setSnapshot((prev) =>
      prev
        ? {
            ...prev,
            security: {
              ...prev.security,
              rules: prev.security.rules.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)),
            },
          }
        : prev,
    );
    void apiToggleRule(id);
  }, []);

  const value = useMemo<NexrelmValue>(
    () => ({ status, mode, snapshot, metrics, logs, alerts, eventCount, runVmAction, toggleRule }),
    [status, mode, snapshot, metrics, logs, alerts, eventCount, runVmAction, toggleRule],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useNexrelm(): NexrelmValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useNexrelm must be used within <NexrelmProvider>');
  return ctx;
}

/** Convenience: read the snapshot once it has loaded, or null while booting. */
export function useSnapshot(): Snapshot | null {
  return useNexrelm().snapshot;
}
