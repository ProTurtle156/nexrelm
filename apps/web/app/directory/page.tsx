'use client';

import { useState } from 'react';
import { LayoutDashboard, UsersRound, Boxes, MonitorSmartphone, TerminalSquare, Plug, ServerCog, Server, Lock } from 'lucide-react';
import type { DirectoryStatus } from '@nexrelm/types';
import { dirSend, useDir } from '@/lib/directory';
import { cn } from '@/lib/format';
import { Loading } from '@/components/ui/Loading';
import { StatusDot } from '@/components/ui/StatusDot';
import { Connect } from '@/components/directory/Connect';
import { Overview, Devices } from '@/components/directory/Overview';
import { Users } from '@/components/directory/Users';
import { Groups } from '@/components/directory/Groups';
import { Servers } from '@/components/directory/Servers';
import { Shell } from '@/components/directory/Shell';

const TABS = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'users', label: 'Users', icon: UsersRound },
  { id: 'groups', label: 'Groups', icon: Boxes },
  { id: 'devices', label: 'Devices', icon: MonitorSmartphone },
  { id: 'servers', label: 'Servers', icon: Server },
  { id: 'shell', label: 'Shell', icon: TerminalSquare },
] as const;

type TabId = (typeof TABS)[number]['id'];

export default function DirectoryPage() {
  const status = useDir<DirectoryStatus>('/api/directory/status', 15000);
  const [tab, setTab] = useState<TabId>('overview');
  const [focusUser, setFocusUser] = useState<string | null>(null);

  const pickUser = (userId: string) => {
    setFocusUser(userId);
    setTab('users');
  };

  if (status.loading && !status.data) return <Loading label="checking directory connection" />;
  const connected = status.data?.connected ?? false;

  if (!connected) return <Connect onConnected={status.refresh} prevError={status.data?.error} />;

  const authLost = () => status.refresh();

  return (
    <div className="flex flex-col gap-5">
      {/* connection bar */}
      <div className="panel flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <StatusDot color="var(--good)" />
          <div>
            <div className="label">Connected</div>
            <div className="stat text-sm text-text">{status.data?.domain}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ServerCog size={14} className="text-faint" />
          <div>
            <div className="label">Domain Controller</div>
            <div className="stat text-sm text-text">{status.data?.host}</div>
          </div>
        </div>
        <div className="hidden sm:block">
          <div className="label">Signed in as</div>
          <div className="stat text-sm text-text">{status.data?.username}</div>
        </div>
        {status.data?.remembered && (
          <span className="hidden items-center gap-1.5 rounded-full border border-good/40 bg-[color-mix(in_oklch,var(--good)_10%,transparent)] px-2.5 py-1 text-xs text-good md:inline-flex" title="Credentials encrypted at rest — auto-restores after a restart">
            <Lock size={12} /> retained
          </span>
        )}
        <button
          onClick={async () => {
            await dirSend('POST', '/api/directory/disconnect');
            status.refresh();
          }}
          className="ml-auto flex items-center gap-2 rounded-xl border border-line px-4 py-2 text-sm text-muted hover:text-text"
          title="Disconnect and wipe the retained credentials"
        >
          <Plug size={15} /> Disconnect
        </button>
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

      {tab === 'overview' && <Overview onAuthLost={authLost} />}
      {tab === 'users' && <Users onAuthLost={authLost} focusUser={focusUser} onFocusConsumed={() => setFocusUser(null)} />}
      {tab === 'groups' && <Groups />}
      {tab === 'devices' && <Devices onAuthLost={authLost} onPickUser={pickUser} />}
      {tab === 'servers' && <Servers onAuthLost={authLost} />}
      {tab === 'shell' && <Shell host={status.data?.host?.split(':')[0]} username={status.data?.username} />}
    </div>
  );
}
