import type { ReactNode } from 'react';

interface GaugeProps {
  /** 0..1 fill. */
  ratio: number;
  color?: string;
  size?: number;
  thickness?: number;
  label?: string;
  center?: ReactNode;
}

/** A circular progress gauge with a glowing arc and a value in the middle. */
export function Gauge({ ratio, color = 'var(--accent)', size = 132, thickness = 9, label, center }: GaugeProps) {
  const r = Math.max(0, Math.min(1, ratio));
  const radius = (size - thickness) / 2;
  const circ = 2 * Math.PI * radius;
  const dash = circ * r;
  const cx = size / 2;

  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90 overflow-visible">
        <circle cx={cx} cy={cx} r={radius} fill="none" stroke="var(--line)" strokeWidth={thickness} strokeOpacity={0.55} />
        <circle
          cx={cx}
          cy={cx}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={thickness}
          strokeLinecap={r > 0.96 ? 'butt' : 'round'}
          strokeDasharray={`${dash} ${circ}`}
          style={{ filter: `drop-shadow(0 0 4px color-mix(in oklch, ${color} 55%, transparent))`, transition: 'stroke-dasharray 0.8s cubic-bezier(0.16,1,0.3,1)' }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          {center ?? <span className="stat text-2xl font-semibold">{Math.round(r * 100)}</span>}
          {label && <div className="label mt-0.5">{label}</div>}
        </div>
      </div>
    </div>
  );
}
