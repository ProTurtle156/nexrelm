/**
 * Remediation engine — turns detections and scan findings into concrete actions
 * Nexrelm can actually take (block an IP at the firewall, block a domain in DNS,
 * block a port), plus informative recommendations for things out of scope. The
 * operator applies or dismisses each one.
 */
import type { RemediationItem, RemediationState, SecurityAlert } from '@nexrelm/types';
import { detectThreats } from './heuristics';
import { currentScan, scorePosture } from './scan';
import { ruleAdd } from './firewall';
import { domainAdd } from '../dns';

const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/;
const DOMAIN = /^([a-z0-9_-]+\.)+[a-z]{2,}$/i;
const ORDER = { critical: 0, high: 1, medium: 2, low: 3, info: 4 } as const;
const PENDING_TTL = 60 * 60 * 1000; // a flagged threat stays actionable for 1h

const dismissed = new Set<string>();
const applied = new Map<string, { id: string; title: string; ts: string }>();
// persisted flagged threats — stay in the tab until applied/dismissed (or expire)
const pending = new Map<string, { item: RemediationItem; ts: number }>();

// kinds where the alert's source IS the attacker → blocking that IP is the right fix
const OFFENDER_KINDS = new Set([
  'port_scan', 'ddos', 'query_flood', 'nxdomain_flood', 'dns_recon', 'dga',
  'data_exfil', 'malware_domain', 'llmnr_poison', 'ad_attack', 'beaconing',
  'lateral_movement', 'spoofing', 'anomaly',
]);
// L2/MITM where the source is a victim/identity, not an IP you should block at L3
const ADVICE_KINDS: Record<string, string> = {
  arp_spoof: 'Locate and disconnect the spoofing host; enable Dynamic ARP Inspection / static ARP for the gateway. Blocking an IP will not stop L2 poisoning.',
  mac_spoof: 'Find the device presenting multiple identities (check the switch MAC table); enable port-security. This is an L2 issue, not an L3 block.',
  rogue_dhcp: 'Locate and disconnect the rogue DHCP server; enable DHCP snooping on your switch. A firewall IP block will not stop broadcast DHCP.',
  suspicious_domain: 'Review the flagged domains; block them in DNS (Firewall/DNS) if confirmed malicious.',
  new_device: 'Review this device in the Devices tab — approve it as known if expected, or block it if it should not be on the network.',
  baseline_anomaly: 'Investigate what changed on this device. If the new behaviour is legitimate, the baseline will re-learn it; if not, treat it as compromise.',
  geo_anomaly: 'Confirm whether traffic to this region is expected. If not, block the destination in DNS/Firewall and inspect the device.',
};

/** Called by the event runner when a threat is flagged, so it persists here. */
export function recordThreat(a: SecurityAlert): void {
  const put = (id: string, item: RemediationItem): void => {
    if (dismissed.has(id) || applied.has(id)) return;
    pending.set(id, { item, ts: Date.now() });
  };
  // domain-blockable threats (evidence carries the domain)
  if ((a.kind === 'malware_domain' || a.kind === 'suspicious_domain' || a.kind === 'beaconing') && a.evidence && DOMAIN.test(a.evidence)) {
    put(`block_dom:${a.evidence}`, { id: `block_dom:${a.evidence}`, severity: a.severity, title: `Block ${a.evidence}`, detail: a.detail, target: a.evidence, source: 'threat', mitre: a.mitre, action: { kind: 'block_domain', label: 'Block this domain in DNS' } });
  }
  // IP-source threats: block the offender, or give scoped advice for L2/MITM
  if (IPV4.test(a.source)) {
    if (OFFENDER_KINDS.has(a.kind)) {
      put(`block_ip:${a.source}`, { id: `block_ip:${a.source}`, severity: a.severity, title: `Block ${a.source}`, detail: a.detail, target: a.source, source: 'threat', mitre: a.mitre, action: { kind: 'block_ip', label: 'Block this source at the firewall' } });
    } else if (ADVICE_KINDS[a.kind]) {
      put(`advice:${a.kind}:${a.source}`, { id: `advice:${a.kind}:${a.source}`, severity: a.severity, title: a.title, detail: `${a.detail} — ${ADVICE_KINDS[a.kind]}`, target: a.source, source: 'threat', mitre: a.mitre, action: { kind: 'advice', label: 'Acknowledge' } });
    }
  }
}

function deriveItems(): RemediationItem[] {
  const out: RemediationItem[] = [];
  const seen = new Set<string>();
  const add = (it: RemediationItem): void => {
    if (dismissed.has(it.id) || seen.has(it.id)) return;
    seen.add(it.id);
    out.push({ ...it, applied: applied.has(it.id) });
  };

  // persisted flagged threats first (stay until acted on, or 1h expiry)
  for (const [id, p] of pending) {
    if (Date.now() - p.ts > PENDING_TTL) {
      pending.delete(id);
      continue;
    }
    add(p.item);
  }

  // from live threat detections
  for (const a of detectThreats()) {
    if (IPV4.test(a.source)) add({ id: `block_ip:${a.source}`, severity: a.severity, title: `Block ${a.source}`, detail: a.detail, target: a.source, source: 'threat', mitre: a.mitre, action: { kind: 'block_ip', label: 'Block this source at the firewall' } });
    if (a.kind === 'malware_domain' && a.evidence && DOMAIN.test(a.evidence)) add({ id: `block_dom:${a.evidence}`, severity: a.severity, title: `Block ${a.evidence}`, detail: a.detail, target: a.evidence, source: 'threat', mitre: a.mitre, action: { kind: 'block_domain', label: 'Block this domain in DNS' } });
  }

  // from the last scan's findings (per device) — INFORMATIVE ONLY: nmap/vuln
  // findings are surfaced as recommendations to read, never as a block action.
  const scan = currentScan();
  if (scan?.hosts.length) {
    for (const f of scorePosture(scan.hosts).findings) {
      const id = `vuln:${f.host ?? '?'}:${f.title}`.slice(0, 140);
      add({ id, severity: f.severity, title: f.title, detail: `${f.detail} — ${f.recommendation}`, target: f.host, source: 'vulnerability', action: { kind: 'advice', label: 'Acknowledge' } });
    }
  }

  return out.sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
}

export function remediationState(): RemediationState {
  return { items: deriveItems(), applied: [...applied.values()].reverse().slice(0, 50) };
}

export function applyRemediation(id: string): { ok: boolean; error?: string } {
  const item = deriveItems().find((i) => i.id === id);
  if (!item) return { ok: false, error: 'no such remediation (it may have cleared)' };
  try {
    if (item.action.kind === 'block_ip' && item.target) {
      ruleAdd({ direction: 'inbound', action: 'drop', source: item.target, comment: `remediation: ${item.title}` });
    } else if (item.action.kind === 'block_domain' && item.target) {
      domainAdd({ type: 'block', kind: 'exact', domain: item.target, comment: `remediation: ${item.title}` });
    } else if (item.action.kind === 'block_port') {
      const port = item.title.match(/:(\d+)$/)?.[1] ?? item.action.label.match(/(\d+)/)?.[1];
      if (port) ruleAdd({ direction: 'inbound', action: 'drop', proto: 'tcp', port, source: 'any', comment: `remediation: ${item.title}` });
    }
    applied.set(id, { id, title: item.title, ts: new Date().toISOString() });
    pending.delete(id);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'apply failed' };
  }
}

export function dismissRemediation(id: string): void {
  dismissed.add(id);
  pending.delete(id);
}

/** Remediate many at once: apply actionable items, acknowledge advice ones. */
export function applyMany(ids: string[]): { applied: number; failed: number } {
  let applied = 0;
  let failed = 0;
  for (const id of ids) {
    const item = deriveItems().find((i) => i.id === id);
    if (!item || item.applied) continue;
    if (item.action.kind === 'advice') {
      dismissRemediation(id);
      applied += 1;
      continue;
    }
    if (applyRemediation(id).ok) applied += 1;
    else failed += 1;
  }
  return { applied, failed };
}

/** Ignore (dismiss) many at once. */
export function dismissMany(ids: string[]): number {
  for (const id of ids) dismissRemediation(id);
  return ids.length;
}
