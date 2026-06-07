/** Formatting + tiny class-name helpers used across the GUI. */

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export function num(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

export function compact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return strip((n / 1_000_000).toFixed(1)) + 'M';
  if (abs >= 1_000) return strip((n / 1_000).toFixed(1)) + 'k';
  return String(Math.round(n));
}

function strip(s: string): string {
  return s.replace(/\.0$/, '');
}

export function pct(ratio: number, digits = 0): string {
  return `${(ratio * 100).toFixed(digits)}%`;
}

export function uptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function relTime(isoStr: string): string {
  const diff = Date.now() - new Date(isoStr).getTime();
  const s = Math.max(0, Math.floor(diff / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function hms(isoStr: string): string {
  return new Date(isoStr).toLocaleTimeString('en-GB', { hour12: false });
}

export function signed(n: number, digits = 1): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(digits)}`;
}
