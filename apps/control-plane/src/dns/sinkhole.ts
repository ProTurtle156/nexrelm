/**
 * Threat-intel DNS sinkhole. The security module pushes its known-bad domain set
 * (abuse.ch / VirusTotal) in here; the resolver checks every query against it and
 * sinkholes matches (same block response as a blocklist hit) instead of merely
 * alerting. Lives in the dns module so the resolver can consult it without
 * importing the security module (keeps the dependency one-way: security → dns).
 * Off by default.
 */
let enabled = false;
const domains = new Set<string>();
let blocked = 0;
let lastLoaded: string | undefined;

export function setSinkholeEnabled(on: boolean): void {
  enabled = on;
}

export function setSinkholeDomains(list: Iterable<string>): void {
  domains.clear();
  for (const d of list) {
    const dd = d.toLowerCase().replace(/\.$/, '').trim();
    if (dd) domains.add(dd);
  }
  lastLoaded = new Date().toISOString();
}

/** True if the name (or any parent domain) is in the sinkhole set. */
export function sinkholeMatch(name: string): boolean {
  if (!enabled || domains.size === 0) return false;
  let n = name.toLowerCase().replace(/\.$/, '');
  if (domains.has(n)) return true;
  let idx = n.indexOf('.');
  while (idx !== -1) {
    n = n.slice(idx + 1);
    if (domains.has(n)) return true;
    idx = n.indexOf('.');
  }
  return false;
}

export function noteSinkholeBlock(): void {
  blocked += 1;
}

export function sinkholeState(): { enabled: boolean; domains: number; blocked: number; lastLoaded?: string } {
  return { enabled, domains: domains.size, blocked, lastLoaded };
}
