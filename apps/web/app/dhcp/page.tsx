'use client';

import { useEffect, useState } from 'react';
import { BarChart3, Network, ScrollText, Pin, SlidersHorizontal, Shapes, ShieldBan, Settings as SettingsIcon } from 'lucide-react';
import type { DhcpScopeDef, DhcpServerStatus } from '@nexrelm/types';
import { useDhcp } from '@/lib/dhcp';
import { cn } from '@/lib/format';
import { StatusBar } from '@/components/dhcp/StatusBar';
import { Statistics } from '@/components/dhcp/Statistics';
import { Scopes } from '@/components/dhcp/Scopes';
import { Leases } from '@/components/dhcp/Leases';
import { Reservations } from '@/components/dhcp/Reservations';
import { Options } from '@/components/dhcp/Options';
import { Policies } from '@/components/dhcp/Policies';
import { Filters } from '@/components/dhcp/Filters';
import { Settings } from '@/components/dhcp/Settings';

const TABS = [
  { id: 'stats', label: 'Statistics', icon: BarChart3, scoped: false },
  { id: 'scopes', label: 'Scopes', icon: Network, scoped: true },
  { id: 'leases', label: 'Leases', icon: ScrollText, scoped: true },
  { id: 'reservations', label: 'Reservations', icon: Pin, scoped: true },
  { id: 'options', label: 'Options', icon: SlidersHorizontal, scoped: true },
  { id: 'policies', label: 'Policies', icon: Shapes, scoped: true },
  { id: 'filters', label: 'Filters', icon: ShieldBan, scoped: false },
  { id: 'settings', label: 'Settings', icon: SettingsIcon, scoped: false },
] as const;

type TabId = (typeof TABS)[number]['id'];

export default function DhcpPage() {
  const [tab, setTab] = useState<TabId>('stats');
  const status = useDhcp<DhcpServerStatus>('/api/dhcp/status', 5000);
  const { data: scopes, refresh: refreshScopes } = useDhcp<DhcpScopeDef[]>('/api/dhcp/scopes', 0);
  const [scopeId, setScopeId] = useState<string | null>(null);

  useEffect(() => {
    if (scopes && scopes.length && (!scopeId || !scopes.some((s) => s.id === scopeId))) setScopeId(scopes[0]!.id);
  }, [scopes, scopeId]);

  const list = scopes ?? [];
  const active = TABS.find((t) => t.id === tab);

  return (
    <div className="flex flex-col gap-5">
      <StatusBar status={status.data} error={status.error} onChange={status.refresh} />

      <nav className="flex flex-wrap items-center gap-1 border-b border-line">
        {TABS.map((t) => {
          const Icon = t.icon;
          const on = tab === t.id;
          return (
            <button key={t.id} onClick={() => setTab(t.id)} className={cn('relative flex items-center gap-2 px-4 py-2.5 text-sm transition-colors', on ? 'text-text' : 'text-muted hover:text-text')}>
              <Icon size={15} className={on ? 'text-accent' : ''} />
              {t.label}
              {on && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent shadow-glow" />}
            </button>
          );
        })}
        {active?.scoped && list.length > 0 && (
          <div className="ml-auto flex items-center gap-2 py-1.5">
            <span className="label">scope</span>
            <select value={scopeId ?? ''} onChange={(e) => setScopeId(e.target.value)} className="rounded-lg border border-line bg-[var(--bg-2)] px-3 py-1.5 text-sm text-text outline-none focus:border-accent/50">
              {list.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.subnet})</option>)}
            </select>
          </div>
        )}
      </nav>

      {tab === 'stats' && <Statistics />}
      {tab === 'scopes' && <Scopes scopes={list} scopeId={scopeId} setScopeId={setScopeId} refreshScopes={refreshScopes} />}
      {tab === 'leases' && <Leases scopeId={scopeId} />}
      {tab === 'reservations' && <Reservations scopeId={scopeId} />}
      {tab === 'options' && <Options scopes={list} scopeId={scopeId} refreshScopes={refreshScopes} />}
      {tab === 'policies' && <Policies scopeId={scopeId} />}
      {tab === 'filters' && <Filters />}
      {tab === 'settings' && <Settings />}
    </div>
  );
}
