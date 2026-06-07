'use client';

import type { DnsResolverStats } from '@nexrelm/types';
import { useDns } from '@/lib/dns';
import { compact, num } from '@/lib/format';
import { Panel, PanelHeader } from '@/components/ui/Panel';
import { Loading } from '@/components/ui/Loading';
import { PieChart } from '@/components/ui/PieChart';
import { BarList } from '@/components/ui/BarList';
import { ActivityChart } from './ActivityChart';

function Kpi({ label, value, tone, sub }: { label: string; value: string; tone: string; sub?: string }) {
  return (
    <div className="panel-2 relative flex flex-col gap-1 overflow-hidden p-4">
      <span className="label">{label}</span>
      <span className="stat text-3xl font-semibold tracking-tight" style={{ color: tone }}>
        {value}
      </span>
      {sub && <span className="text-xs text-faint">{sub}</span>}
      <span className="pointer-events-none absolute inset-x-0 bottom-0 h-px opacity-60" style={{ background: `linear-gradient(90deg, transparent, ${tone}, transparent)` }} />
    </div>
  );
}

export function Dashboard() {
  const { data: s, loading } = useDns<DnsResolverStats>('/api/dns/stats', 5000);
  if (loading && !s) return <Loading label="loading statistics" />;
  if (!s) return null;

  return (
    <div className="flex flex-col gap-5">
      {/* the four Pi-hole headline KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Total Queries" value={num(s.totalQueries)} tone="var(--accent)" sub={`${num(s.uniqueClients)} clients · ${num(s.uniqueDomains)} domains`} />
        <Kpi label="Queries Blocked" value={num(s.blocked)} tone="var(--danger)" sub={`${num(s.cached)} cached · ${num(s.forwarded)} forwarded`} />
        <Kpi label="Percent Blocked" value={`${s.blockedPct}%`} tone="var(--warn)" sub={`avg reply ${s.replyTimeMs}ms`} />
        <Kpi label="Domains on Lists" value={compact(s.domainsOnLists)} tone="var(--violet)" sub="across all your blocklists" />
      </div>

      {/* activity + query types */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Panel brackets className="xl:col-span-2">
          <PanelHeader label="Activity" title="Queries over last 24 hours" hint="total (cyan) vs blocked (red)" />
          <div className="px-3 pb-4 pt-2">
            <ActivityChart data={s.series} />
          </div>
        </Panel>
        <Panel>
          <PanelHeader label="Query Types" title="By record type" />
          <div className="px-5 pb-5 pt-3">
            <PieChart data={s.queryTypes.map((q) => ({ label: q.type, value: q.count }))} />
          </div>
        </Panel>
      </div>

      {/* top domains */}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <Panel>
          <PanelHeader label="Top Permitted" title="Most-resolved domains" />
          <div className="px-3 pb-4 pt-2">
            <BarList color="var(--good)" items={s.topAllowed.map((d) => ({ label: d.domain, value: d.count }))} />
          </div>
        </Panel>
        <Panel>
          <PanelHeader label="Top Blocked" title="Most-blocked domains" />
          <div className="px-3 pb-4 pt-2">
            <BarList color="var(--danger)" items={s.topBlocked.map((d) => ({ label: d.domain, value: d.count }))} />
          </div>
        </Panel>
      </div>

      {/* top clients */}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <Panel>
          <PanelHeader label="Top Clients" title="By total activity" />
          <div className="px-3 pb-4 pt-2">
            <BarList color="var(--accent)" items={s.topClients.map((c) => ({ label: c.name ? `${c.name}` : c.client, value: c.count, sub: c.name ? c.client : undefined }))} />
          </div>
        </Panel>
        <Panel>
          <PanelHeader label="Top Clients" title="By blocked queries" />
          <div className="px-3 pb-4 pt-2">
            <BarList color="var(--warn)" items={s.topClientsByBlocked.map((c) => ({ label: c.name ? `${c.name}` : c.client, value: c.count, sub: c.name ? c.client : undefined }))} />
          </div>
        </Panel>
      </div>
    </div>
  );
}
