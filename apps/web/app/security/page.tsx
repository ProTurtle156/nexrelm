'use client';

import { useState } from 'react';
import { LayoutDashboard, Shield, Radar, Bug, ClipboardCheck, MonitorSmartphone, Ban } from 'lucide-react';
import { cn } from '@/lib/format';
import { Pause } from '@/components/security/Pause';
import { SecOverview } from '@/components/security/Overview';
import { Firewall } from '@/components/security/Firewall';
import { Vulnerabilities } from '@/components/security/Vulnerabilities';
import { Threats } from '@/components/security/Threats';
import { Remediation } from '@/components/security/Remediation';
import { Devices } from '@/components/security/Devices';
import { Blocked } from '@/components/security/Blocked';

const TABS = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'threats', label: 'Threats', icon: Bug },
  { id: 'remediation', label: 'Remediation', icon: ClipboardCheck },
  { id: 'blocked', label: 'Blocked', icon: Ban },
  { id: 'devices', label: 'Devices', icon: MonitorSmartphone },
  { id: 'firewall', label: 'Firewall', icon: Shield },
  { id: 'vulnerabilities', label: 'Vulnerabilities', icon: Radar },
] as const;

type TabId = (typeof TABS)[number]['id'];

export default function SecurityPage() {
  const [tab, setTab] = useState<TabId>('overview');

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="label">Security</div>
          <h1 className="mt-0.5 text-lg font-medium text-text">Network defense</h1>
        </div>
        <Pause />
      </div>

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

      {tab === 'overview' && <SecOverview />}
      {tab === 'threats' && <Threats />}
      {tab === 'remediation' && <Remediation />}
      {tab === 'blocked' && <Blocked />}
      {tab === 'devices' && <Devices />}
      {tab === 'firewall' && <Firewall />}
      {tab === 'vulnerabilities' && <Vulnerabilities />}
    </div>
  );
}
