'use client';

/** Directory (AD/Samba) control-plane client — same plumbing as the other tabs. */
export { useDns as useDir, dnsGet as dirGet, dnsSend as dirSend, DNS_API as DIR_API } from './dns';
