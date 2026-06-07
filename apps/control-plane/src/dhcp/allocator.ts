/** Lease allocation: pick an address for a client within a scope. */
import type { DhcpScopeDef } from '@nexrelm/types';
import { exclusionsAll, intToIp, ipInRange, ipToInt, leaseByIp, leaseByMac, reservationByMac, reservationsAll } from './db';

/**
 * Allocate an address for `mac` in `scope`, honoring reservations, the client's
 * existing lease, a requested address, exclusions and in-use addresses. Returns
 * null if the pool is exhausted.
 */
export function allocate(scope: DhcpScopeDef, mac: string, requestedIp?: string): string | null {
  const now = Date.now();
  const m = mac.toLowerCase();

  // 1) a reservation always wins
  const res = reservationByMac(m);
  if (res && res.scopeId === scope.id) return res.ip;

  const exclusions = exclusionsAll(scope.id);
  const reservedIps = new Set(reservationsAll(scope.id).map((r) => r.ip));
  const excluded = (ip: string): boolean => exclusions.some((e) => ipInRange(ip, e.start, e.end));
  const free = (ip: string): boolean => {
    if (excluded(ip)) return false;
    if (reservedIps.has(ip)) return false; // reserved for some MAC (not this one, handled above)
    const l = leaseByIp(ip);
    if (!l) return true;
    if (l.mac.toLowerCase() === m) return true; // our own lease
    const live = (l.state === 'active' || l.state === 'offered' || l.state === 'reserved' || l.state === 'declined') && new Date(l.expiresAt).getTime() > now;
    return !live;
  };

  // 2) reuse our current lease if still valid
  const existing = leaseByMac(m, scope.id);
  if (existing && ipInRange(existing.ip, scope.rangeStart, scope.rangeEnd) && !excluded(existing.ip)) return existing.ip;

  // 3) honor the client's requested address
  if (requestedIp && ipInRange(requestedIp, scope.rangeStart, scope.rangeEnd) && free(requestedIp)) return requestedIp;

  // 4) first free address in range
  for (let v = ipToInt(scope.rangeStart); v <= ipToInt(scope.rangeEnd); v++) {
    const ip = intToIp(v);
    if (free(ip)) return ip;
  }
  return null;
}

/** Is `ip` a valid assignment for `mac` (reservation match or in-range + free-ish)? */
export function canAssign(scope: DhcpScopeDef, mac: string, ip: string): boolean {
  const m = mac.toLowerCase();
  const res = reservationByMac(m);
  if (res && res.scopeId === scope.id) return res.ip === ip;
  if (!ipInRange(ip, scope.rangeStart, scope.rangeEnd)) return false;
  if (exclusionsAll(scope.id).some((e) => ipInRange(ip, e.start, e.end))) return false;
  if (reservationsAll(scope.id).some((r) => r.ip === ip)) return false;
  const l = leaseByIp(ip);
  if (l && l.mac.toLowerCase() !== m && new Date(l.expiresAt).getTime() > Date.now() && l.state !== 'expired' && l.state !== 'released') return false;
  return true;
}
