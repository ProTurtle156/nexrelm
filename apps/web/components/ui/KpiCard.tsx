import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import type { Kpi } from '@nexrelm/types';
import { compact, num, signed } from '@/lib/format';
import { toneVar } from '@/lib/ui';
import { Sparkline } from './Sparkline';

interface KpiCardProps {
  kpi: Kpi;
  /** Live overrides streamed from the WS channel. */
  liveValue?: number;
  liveSeries?: number[];
}

export function KpiCard({ kpi, liveValue, liveSeries }: KpiCardProps) {
  const color = toneVar(kpi.tone);
  const value = liveValue ?? kpi.value;
  const series = liveSeries ?? kpi.series;
  const up = (kpi.delta ?? 0) >= 0;
  const display = value >= 10_000 ? compact(value) : num(value);

  return (
    <div className="panel-2 group relative flex flex-col gap-3 p-4 transition-colors hover:border-line-strong">
      <div className="flex items-start justify-between">
        <span className="label">{kpi.label}</span>
        {kpi.delta !== undefined && (
          <span
            className="inline-flex items-center gap-0.5 font-mono text-[0.68rem]"
            style={{ color: up ? 'var(--good)' : 'var(--danger)' }}
          >
            {up ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
            {signed(kpi.delta)}%
          </span>
        )}
      </div>
      <div className="flex items-baseline gap-1">
        <span className="stat text-3xl font-semibold tracking-tight" style={{ color }}>
          {display}
        </span>
        {kpi.unit && <span className="stat text-sm text-muted">{kpi.unit}</span>}
      </div>
      {series && series.length > 1 && (
        <div className="-mb-1">
          <Sparkline data={series} color={color} width={220} height={36} />
        </div>
      )}
      <span
        className="pointer-events-none absolute inset-x-0 bottom-0 h-px opacity-60"
        style={{ background: `linear-gradient(90deg, transparent, ${color}, transparent)` }}
      />
    </div>
  );
}
