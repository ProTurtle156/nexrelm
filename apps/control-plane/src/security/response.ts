/**
 * Active response (IPS-style): when enabled, a detection at/above the chosen
 * severity auto-adds a firewall block for the offending source IP. Off by
 * default; the operator picks the threshold.
 */
import type { ActiveResponseState, SecSeverity, SecurityAlert } from '@nexrelm/types';
import { ruleAdd } from './firewall';

const RANK: Record<SecSeverity, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };
const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/;
// kinds where the source is a victim/identity or a soft signal — never auto-block these
const NO_AUTOBLOCK = new Set(['arp_spoof', 'mac_spoof', 'rogue_dhcp', 'new_device', 'baseline_anomaly', 'geo_anomaly']);

let enabled = false;
let minSeverity: SecSeverity = 'critical';
const blocked: Array<{ ip: string; reason: string; ts: string }> = [];

export function activeResponseState(): ActiveResponseState {
  return { enabled, minSeverity, blocked: [...blocked].reverse().slice(0, 50) };
}

export function setActiveResponse(p: { enabled?: boolean; minSeverity?: SecSeverity }): ActiveResponseState {
  if (p.enabled != null) enabled = p.enabled;
  if (p.minSeverity) minSeverity = p.minSeverity;
  return activeResponseState();
}

/** Block the alert's source if policy allows. Returns the action taken, if any. */
export function maybeRespond(a: SecurityAlert): string | undefined {
  if (!enabled || RANK[a.severity] < RANK[minSeverity]) return undefined;
  if (NO_AUTOBLOCK.has(a.kind)) return undefined; // blocking a victim IP would be wrong
  if (!IPV4.test(a.source)) return undefined; // needs a concrete source IP
  if (blocked.some((b) => b.ip === a.source)) return 'already blocked';
  ruleAdd({ direction: 'inbound', action: 'drop', source: a.source, comment: `auto-response: ${a.title}` });
  blocked.push({ ip: a.source, reason: a.title, ts: new Date().toISOString() });
  return 'blocked source';
}
