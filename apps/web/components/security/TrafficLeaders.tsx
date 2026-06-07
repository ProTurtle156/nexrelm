'use client';

import { ArrowUpRight, ArrowDownLeft } from 'lucide-react';
import type { SecurityOverview } from '@nexrelm/types';
import { useSec } from '@/lib/security';
import { num } from '@/lib/format';
import { Panel, PanelHeader } from '@/components/ui/Panel';

type Entry = SecurityOverview['topSources'][number];

/**
 * Traffic leaders — busiest source IPs (clients sending) and destination IPs
 * (answer IPs receiving), each as a lollipop chart (a distinct read from the
 * filled posture bars elsewhere). Lives in the Firewall tab so you can eyeball
 * who's loudest before writing a rule about them.
 */
export function TrafficLeaders() {
  const { data: o } = useSec<SecurityOverview>('/api/security/overview?window=300', 5000);
  if (!o) return null;
  return (
    <Panel>
      <PanelHeader label="Traffic" title="Traffic leaders" hint="busiest IPs by packet / query count — point of reference for firewall rules" />
      <div className="grid grid-cols-1 gap-x-8 gap-y-2 px-5 pb-5 pt-3 lg:grid-cols-2">
        <Lolli title="Top sources" sub="clients sending" icon={<ArrowUpRight size={13} className="text-accent" />} entries={o.topSources} color="var(--accent)" />
        <Lolli title="Top destinations" sub="answer IPs receiving" icon={<ArrowDownLeft size={13} className="text-violet" />} entries={o.topDestinations} color="var(--violet)" />
      </div>
    </Panel>
  );
}

function Lolli({ title, sub, icon, entries, color }: { title: string; sub: string; icon: React.ReactNode; entries: Entry[]; color: string }) {
  const max = Math.max(1, ...entries.map((e) => e.count));
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between border-b border-line/50 pb-1.5">
        <span className="flex items-center gap-1.5 text-xs font-medium text-text">{icon} {title}</span>
        <span className="text-[0.62rem] uppercase tracking-wide text-faint">{sub}</span>
      </div>
      {entries.length === 0 && <p className="text-sm text-faint">no data yet</p>}
      {entries.slice(0, 8).map((e) => {
        const ratio = e.count / max;
        const pct = Math.max(2, ratio * 100);
        return (
          <div key={e.key} className="flex items-center gap-3">
            <span className="w-32 min-w-0 shrink-0">
              <span className="block truncate font-mono text-xs text-text">{e.label || e.key}</span>
              {e.label && <span className="block truncate font-mono text-[0.6rem] text-faint">{e.key}</span>}
            </span>
            {/* lollipop: thin stem + glowing head */}
            <span className="relative h-3 flex-1">
              <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-line/40" />
              <span className="absolute top-1/2 left-0 h-px -translate-y-1/2" style={{ width: `${pct}%`, background: `color-mix(in oklch, ${color} 70%, transparent)` }} />
              <span className="absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full" style={{ left: `calc(${pct}% - 5px)`, background: color, boxShadow: `0 0 6px ${color}` }} />
            </span>
            <span className="stat w-14 shrink-0 text-right text-xs text-muted">{num(e.count)}</span>
          </div>
        );
      })}
    </div>
  );
}
