interface SparklineProps {
  data: number[];
  color?: string;
  width?: number;
  height?: number;
  /** Fill the area under the line with a faint gradient. */
  fill?: boolean;
  strokeWidth?: number;
}

/** Tiny dependency-free trend line. Auto-scales to its own min/max. */
export function Sparkline({
  data,
  color = 'var(--accent)',
  width = 120,
  height = 34,
  fill = true,
  strokeWidth = 1.5,
}: SparklineProps) {
  if (data.length < 2) {
    return <svg width={width} height={height} aria-hidden />;
  }
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pad = strokeWidth + 1;
  const stepX = (width - pad * 2) / (data.length - 1);
  const y = (v: number): number => pad + (1 - (v - min) / span) * (height - pad * 2);
  const pts = data.map((v, i) => `${(pad + i * stepX).toFixed(2)},${y(v).toFixed(2)}`);
  const line = `M${pts.join(' L')}`;
  const area = `${line} L${(pad + (data.length - 1) * stepX).toFixed(2)},${height - pad} L${pad},${height - pad} Z`;
  const gid = `sl-${color.replace(/[^a-z]/gi, '')}-${width}-${height}`;

  return (
    <svg width={width} height={height} className="overflow-visible" aria-hidden>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.32} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      {fill && <path d={area} fill={`url(#${gid})`} />}
      <path d={line} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={pad + (data.length - 1) * stepX} cy={y(data[data.length - 1]!)} r={2} fill={color} />
    </svg>
  );
}
