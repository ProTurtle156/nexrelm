'use client';

import { useState } from 'react';
import { LayoutDashboard, Server, TerminalSquare } from 'lucide-react';
import { cn } from '@/lib/format';
import { VmOverview } from '@/components/vms/Overview';
import { VmList } from '@/components/vms/VmList';
import { VmTerminal } from '@/components/vms/VmTerminal';

const TABS = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'vms', label: 'VMs', icon: Server },
  { id: 'terminal', label: 'Terminal', icon: TerminalSquare },
] as const;

type TabId = (typeof TABS)[number]['id'];

export default function VirtualizationPage() {
  const [tab, setTab] = useState<TabId>('overview');
  const [termVm, setTermVm] = useState<string | null>(null);

  const openTerminal = (id: string) => {
    setTermVm(id);
    setTab('terminal');
  };

  return (
    <div className="flex flex-col gap-5">
      <nav className="flex flex-wrap gap-1 border-b border-line">
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
      </nav>

      {tab === 'overview' && <VmOverview onOpenTerminal={openTerminal} onManage={() => setTab('vms')} />}
      {tab === 'vms' && <VmList onOpenTerminal={openTerminal} />}
      {tab === 'terminal' && <VmTerminal initialVmId={termVm} />}
    </div>
  );
}
