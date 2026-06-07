interface AreaChartProps {
  data: number[];
  color?: string;
  height?: number;
  /** Draw faint horizontal gridlines. */
  grid?: boolean;
}

/**
 * A responsive area chart that fills its container width via viewBox.
 * Dependency-free; used for the larger module trend panels.
 */
export function AreaChart({ data, color = 'var(--accent)', height = 160, grid = true }: AreaChartProps) {
  const W = 600;
  const H = height;
  if (data.length < 2) {
    return <div style={{ height }} className="grid place-items-center text-xs text-faint">collecting…</div>;
  }
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const padY = 10;
  const stepX = W / (data.length - 1);
  const y = (v: number): number => padY + (1 - (v - min) / span) * (H - padY * 2);
  const pts = data.map((v, i) => `${(i * stepX).toFixed(2)},${y(v).toFixed(2)}`);
  const line = `M${pts.join(' L')}`;
  const area = `${line} L${W},${H} L0,${H} Z`;
  const gid = `ac-${color.replace(/[^a-z]/gi, '')}`;
  const rows = [0.25, 0.5, 0.75];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.34} />
          <stop offset="100%" stopColor={color} stopOpacity={0.02} />
        </linearGradient>
      </defs>
      {grid &&
        rows.map((r) => (
          <line key={r} x1={0} x2={W} y1={padY + r * (H - padY * 2)} y2={padY + r * (H - padY * 2)} stroke="var(--line)" strokeWidth={1} />
        ))}
      <path d={area} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <circle cx={(data.length - 1) * stepX} cy={y(data[data.length - 1]!)} r={3.5} fill={color}>
        <animate attributeName="opacity" values="1;0.4;1" dur="2s" repeatCount="indefinite" />
      </circle>
    </svg>
  );
}
