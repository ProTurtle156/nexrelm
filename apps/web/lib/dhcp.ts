'use client';

/** DHCP control-plane client — reuses the same API plumbing as the DNS tab. */
export { useDns as useDhcp, dnsGet as dhcpGet, dnsSend as dhcpSend, DNS_API as DHCP_API } from './dns';
