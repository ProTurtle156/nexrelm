'use client';

/** Virtualization (real SSH-backed VMs) control-plane client — shares the dns plumbing. */
export { useDns as useVm, dnsGet as vmGet, dnsSend as vmSend, DNS_API as VMS_API } from './dns';

/** KB → human-friendly size. */
export function fmtKb(kb?: number): string {
  if (kb == null) return '—';
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(0)} MB`;
  const gb = mb / 1024;
  if (gb < 1024) return `${gb.toFixed(gb < 10 ? 1 : 0)} GB`;
  return `${(gb / 1024).toFixed(1)} TB`;
}

export function ratio(used?: number, total?: number): number {
  return total && total > 0 && used != null ? used / total : 0;
}
