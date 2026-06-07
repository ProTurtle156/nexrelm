/**
 * "Blocked things" aggregator — one place to review everything Nexrelm is actively
 * blocking (firewall deny/drop rules, DNS block-list domains, blocked devices) and
 * undo any of it. Reuses the existing firewall/DNS/registry stores; nothing new is
 * persisted here.
 */
import type { BlockedState } from '@nexrelm/types';
import { firewallState, ruleDelete } from './firewall';
import { registryAll, setTrust } from './registry';
import { domainsAll, domainDelete } from '../dns';

export function blockedState(): BlockedState {
  const rules = firewallState().rules.filter((r) => r.action === 'deny' || r.action === 'drop');
  const domains = domainsAll('block');
  const devices = registryAll().devices.filter((d) => d.trust === 'blocked');
  return {
    firewall: rules.map((r) => ({ id: r.id, source: r.source, action: r.action, direction: r.direction, proto: r.proto, port: r.port, comment: r.comment, hits: r.hits })),
    domains: domains.map((d) => ({ id: d.id, domain: d.domain, comment: d.comment, hits: d.hits })),
    devices,
  };
}

/** Undo a block. `id` is the rule id / domain id / device MAC. */
export function unblock(kind: 'firewall' | 'domain' | 'device', id: string): { ok: boolean; error?: string } {
  if (kind === 'firewall') return ruleDelete(id) ? { ok: true } : { ok: false, error: 'no such firewall rule' };
  if (kind === 'domain') {
    domainDelete(Number(id));
    return { ok: true };
  }
  if (kind === 'device') {
    setTrust(id, 'known');
    return { ok: true };
  }
  return { ok: false, error: 'kind must be firewall | domain | device' };
}
