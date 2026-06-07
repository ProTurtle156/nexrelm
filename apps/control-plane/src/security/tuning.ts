/**
 * Heuristic engine tuning — operator-controlled sensitivity + a trusted-host
 * allowlist. Sensitivity scales every detector threshold (low = far fewer alerts,
 * high = more). Trusted hosts (plus this machine's own IPs, which fan out to many
 * upstreams as the resolver) are exempt from the scan/sweep/lateral detectors so
 * busy infrastructure like DNS servers and gateways stop tripping "port scan".
 */
import type { HeuristicSensitivity, HeuristicTuning } from '@nexrelm/types';
import { getSetting, setSetting } from './store';

// >1 raises thresholds (fewer alerts); <1 lowers them (more alerts).
const FACTOR: Record<HeuristicSensitivity, number> = { low: 1.8, medium: 1, high: 0.6 };

export function tuningConfig(): HeuristicTuning {
  let parsed: Partial<HeuristicTuning> = {};
  const raw = getSetting('tuning');
  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      /* defaults */
    }
  }
  return { sensitivity: parsed.sensitivity ?? 'medium', trustedHosts: Array.isArray(parsed.trustedHosts) ? parsed.trustedHosts : [] };
}

export function setTuning(patch: Partial<HeuristicTuning>): HeuristicTuning {
  const cur = tuningConfig();
  const next: HeuristicTuning = {
    sensitivity: patch.sensitivity ?? cur.sensitivity,
    trustedHosts: patch.trustedHosts ?? cur.trustedHosts,
  };
  setSetting('tuning', JSON.stringify(next));
  return next;
}

export function sensitivityFactor(): number {
  return FACTOR[tuningConfig().sensitivity] ?? 1;
}

function ipToInt(ip: string): number | null {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return ((p[0]! << 24) >>> 0) + (p[1]! << 16) + (p[2]! << 8) + p[3]!;
}

function inCidr(ip: string, cidr: string): boolean {
  const [base, bitsStr] = cidr.split('/');
  const bits = Number(bitsStr);
  const ipN = ipToInt(ip);
  const baseN = base ? ipToInt(base) : null;
  if (ipN == null || baseN == null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipN & mask) === (baseN & mask);
}

/** Is this host on the operator's trusted allowlist (exempt from scan/sweep detection)? */
export function isTrustedHost(ip: string): boolean {
  for (const h of tuningConfig().trustedHosts) {
    if (!h) continue;
    if (h.includes('/')) {
      if (inCidr(ip, h)) return true;
    } else if (h === ip) {
      return true;
    }
  }
  return false;
}
