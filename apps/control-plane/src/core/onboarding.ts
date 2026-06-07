/**
 * Onboarding — the data behind the guided "put Nexrelm on the path" wizard.
 * Aggregates LAN/WAN detection, capability grants (does tcpdump/nmap actually
 * have the caps the sniffer/scanner need?), the inline-gateway availability, the
 * live network posture, and a "is real traffic visible right now?" signal — so
 * a non-expert can switch Nexrelm into the network's edge and SEE it working.
 */
import { execFile } from 'node:child_process';
import type { OnboardingState, OnboardingVerify } from '@nexrelm/types';
import { detectLan, detectWan } from '../security/gateway';
import { networkPosture } from '../security/network';
import { snifferState } from '../security/sniffer';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const SAFE_BIN = /^[a-z][a-z0-9_-]{0,31}$/i;
function which(bin: string): Promise<string> {
  if (!SAFE_BIN.test(bin)) return Promise.resolve(''); // never let an unexpected name reach a process
  return new Promise((resolve) => execFile('which', [bin], { timeout: 2000 }, (_e, out) => resolve((out || '').trim().split('\n')[0] ?? '')));
}
/** Does the binary carry cap_net_raw (the capability the sniffer/scanner need)? */
async function hasNetRaw(bin: string): Promise<boolean> {
  const path = await which(bin);
  if (!path) return false;
  return new Promise((resolve) => execFile('getcap', [path], { timeout: 2000 }, (_e, out) => resolve(/cap_net_raw/i.test(out || ''))));
}

export async function onboardingState(): Promise<OnboardingState> {
  const [lan, wanIface, captureCap, scanCap, posture] = await Promise.all([detectLan(), detectWan(), hasNetRaw('tcpdump'), hasNetRaw('nmap'), networkPosture()]);

  const dnsClients = posture.dns.clients;
  const packets = posture.capture.packets;
  const trafficFlowing = dnsClients > 1 || (posture.capture.active && packets > 50) || posture.gateway.enabled;
  const bits: string[] = [];
  if (dnsClients > 0) bits.push(`${dnsClients} client${dnsClients === 1 ? '' : 's'} resolving`);
  if (posture.capture.active) bits.push(`${packets.toLocaleString()} packets captured`);
  if (posture.dhcp.active) bits.push(`${posture.dhcp.leases} DHCP leases`);
  if (posture.gateway.enabled) bits.push(`gateway: ${posture.gateway.mode}`);
  const trafficSignal = bits.length ? bits.join(' · ') : 'no external traffic visible yet';

  return {
    lan,
    wanIface,
    dnsPointAt: lan.ip || posture.lanIp,
    caps: { capture: captureCap, scan: scanCap },
    gatewayAvailable: posture.gateway.available,
    posture,
    trafficFlowing,
    trafficSignal,
    // DNS-pointing is the least invasive way to light up the modules; recommend it.
    recommended: 'dns',
  };
}

/** Active verification for the final wizard step: sample the capture rate + DNS clients. */
export async function verifyTraffic(): Promise<OnboardingVerify> {
  const before = snifferState().packets;
  const posture = await networkPosture();
  await sleep(2500);
  const after = snifferState().packets;
  const packetsDelta = Math.max(0, after - before);
  const dnsClients = posture.dns.clients;
  const flowing = dnsClients > 1 || packetsDelta > 0 || (posture.capture.active && posture.capture.packets > 50) || posture.gateway.enabled;
  const parts: string[] = [];
  if (dnsClients > 1) parts.push(`${dnsClients} clients resolving through Nexrelm`);
  if (packetsDelta > 0) parts.push(`${packetsDelta.toLocaleString()} packets captured in the last few seconds`);
  else if (posture.capture.active) parts.push('capture is on but no packets seen in this sample');
  if (posture.gateway.enabled) parts.push(`routing as the ${posture.gateway.mode} gateway`);
  const detail = parts.length ? parts.join(' · ') : 'No external traffic is reaching Nexrelm yet — point a router/device at it, or enable a mode below.';
  return { flowing, dnsClients, packetsDelta, detail };
}
