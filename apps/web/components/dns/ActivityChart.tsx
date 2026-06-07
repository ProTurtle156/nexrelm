'use client';

import { num } from '@/lib/format';

interface Point {
  t: number;
  total: number;
  blocked: number;
}

/** Round a max up to a clean axis value (1/2/5 × 10ⁿ). */
function niceCeil(n: number): number {
  if (n <= 5) return 5;
  const p = 10 ** Math.floor(Math.log10(n));
  const f = n / p;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nice * p;
}

const hhmm = (t: number): string => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

function Swatch({ color, label, value, sub }: { color: string; label: string; value: string; sub?: string }) {
  return (
    <span className="flex items-center gap-2">
      <span className="h-2.5 w-3.5 rounded-sm" style={{ background: color }} />
      <span className="text-muted">{label}</span>
      <span className="stat text-text">{value}</span>
      {sub && <span className="text-faint">{sub}</span>}
    </span>
  );
}

export function ActivityChart({ data, height = 230 }: { data: Point[]; height?: number }) {
  if (data.length < 2) {
    return <div style={{ height }} className="grid place-items-center text-xs text-faint">collecting query history…</div>;
  }

  const totals = data.map((d) => d.total);
  const blocked = data.map((d) => d.blocked);
  const totalSum = totals.reduce((a, b) => a + b, 0);
  const blockedSum = blocked.reduce((a, b) => a + b, 0);
  const peak = Math.max(...totals);
  const max = niceCeil(peak);
  const blockedPct = totalSum ? Math.round((blockedSum / totalSum) * 100) : 0;

  const W = 1000;
  const H = 100;
  const stepX = W / (data.length - 1);
  const y = (v: number): number => H - (v / max) * H;
  const line = (vals: number[]): string => 'M' + vals.map((v, i) => `${(i * stepX).toFixed(1)},${y(v).toFixed(2)}`).join(' L');
  const area = (vals: number[]): string => `${line(vals)} L${W},${H} L0,${H} Z`;

  const rows = [max, max / 2, 0];
  const tickCount = 6;
  const ticks = Array.from({ length: tickCount }, (_, i) => {
    const idx = Math.round((i / (tickCount - 1)) * (data.length - 1));
    return hhmm(data[idx]!.t);
  });

  return (
    <div>
      {/* legend */}
      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs">
        <Swatch color="var(--chart-1)" label="Total" value={num(totalSum)} />
        <Swatch color="var(--chart-2)" label="Blocked" value={num(blockedSum)} sub={`${blockedPct}%`} />
        <span className="ml-auto text-faint">peak {num(peak)} · 30-min buckets · last 24h</span>
      </div>

      {/* plot with y-axis */}
      <div className="flex" style={{ height }}>
        <div className="flex w-10 shrink-0 flex-col justify-between py-0 pr-2 text-right">
          {rows.map((r) => (
            <span key={r} className="stat text-[0.62rem] leading-none text-faint">{num(r)}</span>
          ))}
        </div>
        <div className="relative flex-1">
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={height} preserveAspectRatio="none" className="overflow-visible">
            <defs>
              <linearGradient id="actTotal" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.28} />
                <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="actBlocked" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--chart-2)" stopOpacity={0.4} />
                <stop offset="100%" stopColor="var(--chart-2)" stopOpacity={0.05} />
              </linearGradient>
            </defs>
            {rows.map((r) => (
              <line key={r} x1={0} x2={W} y1={y(r)} y2={y(r)} stroke="var(--line)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            ))}
            <path d={area(totals)} fill="url(#actTotal)" />
            <path d={line(totals)} fill="none" stroke="var(--chart-1)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
            <path d={area(blocked)} fill="url(#actBlocked)" />
            <path d={line(blocked)} fill="none" stroke="var(--chart-2)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
          </svg>
        </div>
      </div>

      {/* x-axis time labels (aligned under the plot, offset by the y-axis column) */}
      <div className="flex">
        <div className="w-10 shrink-0" />
        <div className="flex flex-1 justify-between pt-1.5">
          {ticks.map((t, i) => (
            <span key={i} className="stat text-[0.62rem] text-faint">{t}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
