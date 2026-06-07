'use client';

/** Security module client — shares the DNS control-plane plumbing. */
export { useDns as useSec, dnsGet as secGet, dnsSend as secSend, DNS_API as SEC_API } from './dns';

export const SEV_COLOR: Record<string, string> = {
  critical: 'var(--danger)',
  high: 'var(--danger)',
  medium: 'var(--warn)',
  low: 'var(--accent)',
  info: 'var(--faint)',
};

export const STATUS_COLOR: Record<string, string> = {
  forwarded: 'var(--accent-dim)',
  cached: 'var(--accent)',
  blocked: 'var(--danger)',
  allowed: 'var(--good)',
  nxdomain: 'var(--warn)',
  refused: 'var(--danger)',
  local: 'var(--violet)',
};
