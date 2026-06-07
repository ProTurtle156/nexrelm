'use client';

import { useState } from 'react';
import { LayoutDashboard, ScrollText, MonitorSmartphone, ListFilter, UsersRound, SlidersHorizontal } from 'lucide-react';
import type { DnsResolverStatus } from '@nexrelm/types';
import { useDns } from '@/lib/dns';
import { cn } from '@/lib/format';
import { StatusBar } from '@/components/dns/StatusBar';
import { Dashboard } from '@/components/dns/Dashboard';
import { QueryLog } from '@/components/dns/QueryLog';
import { Clients } from '@/components/dns/Clients';
import { Lists } from '@/components/dns/Lists';
import { Groups } from '@/components/dns/Groups';
import { Settings } from '@/components/dns/Settings';

const TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'query-log', label: 'Query Log', icon: ScrollText },
  { id: 'clients', label: 'Clients', icon: MonitorSmartphone },
  { id: 'lists', label: 'Lists', icon: ListFilter },
  { id: 'groups', label: 'Groups', icon: UsersRound },
  { id: 'settings', label: 'Settings', icon: SlidersHorizontal },
] as const;

type TabId = (typeof TABS)[number]['id'];

export default function DnsPage() {
  const [tab, setTab] = useState<TabId>('dashboard');
  const status = useDns<DnsResolverStatus>('/api/dns/status', 5000);

  return (
    <div className="flex flex-col gap-5">
      <StatusBar status={status.data} error={status.error} onChange={status.refresh} />

      <nav className="flex flex-wrap gap-1 border-b border-line">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'relative flex items-center gap-2 px-4 py-2.5 text-sm transition-colors',
                active ? 'text-text' : 'text-muted hover:text-text',
              )}
            >
              <Icon size={15} className={active ? 'text-accent' : ''} />
              {t.label}
              {active && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent shadow-glow" />}
            </button>
          );
        })}
      </nav>

      {tab === 'dashboard' && <Dashboard />}
      {tab === 'query-log' && <QueryLog />}
      {tab === 'clients' && <Clients />}
      {tab === 'lists' && <Lists />}
      {tab === 'groups' && <Groups />}
      {tab === 'settings' && <Settings />}
    </div>
  );
}
