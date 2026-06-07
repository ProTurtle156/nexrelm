import type { UpstreamPreset } from '@nexrelm/types';

/** Selectable upstream resolvers, mirroring Pi-hole's preset list. */
export const UPSTREAM_PRESETS: UpstreamPreset[] = [
  { id: 'google', name: 'Google (ECS, DNSSEC)', ipv4: ['8.8.8.8', '8.8.4.4'], ipv6: ['2001:4860:4860::8888', '2001:4860:4860::8844'], ecs: true, dnssec: true },
  { id: 'opendns', name: 'OpenDNS (ECS, DNSSEC)', ipv4: ['208.67.222.222', '208.67.220.220'], ipv6: ['2620:119:35::35', '2620:119:53::53'], ecs: true, dnssec: true },
  { id: 'level3', name: 'Level3', ipv4: ['4.2.2.1', '4.2.2.2'], ipv6: [], ecs: false, dnssec: false },
  { id: 'comodo', name: 'Comodo', ipv4: ['8.26.56.26', '8.20.247.20'], ipv6: [], ecs: false, dnssec: false },
  { id: 'quad9-filtered-dnssec', name: 'Quad9 (filtered, DNSSEC)', ipv4: ['9.9.9.9', '149.112.112.112'], ipv6: ['2620:fe::fe', '2620:fe::9'], ecs: false, dnssec: true },
  { id: 'quad9-unfiltered', name: 'Quad9 (unfiltered, no DNSSEC)', ipv4: ['9.9.9.10', '149.112.112.10'], ipv6: ['2620:fe::10', '2620:fe::fe:10'], ecs: false, dnssec: false },
  { id: 'quad9-filtered-ecs-dnssec', name: 'Quad9 (filtered, ECS, DNSSEC)', ipv4: ['9.9.9.11', '149.112.112.11'], ipv6: ['2620:fe::11', '2620:fe::fe:11'], ecs: true, dnssec: true },
  { id: 'cloudflare', name: 'Cloudflare (DNSSEC)', ipv4: ['1.1.1.1', '1.0.0.1'], ipv6: ['2606:4700:4700::1111', '2606:4700:4700::1001'], ecs: false, dnssec: true },
];

/**
 * A small built-in OUI → vendor table for client enrichment. The full IEEE OUI
 * registry is ~35k entries; this covers common home/lab gear and is easily
 * extended (or replaced with the full oui.txt at deploy time).
 */
export const OUI_VENDORS: Record<string, string> = {
  '8C:84:42': 'Cisco Systems, Inc',
  '00:15:5D': 'Microsoft Corporation',
  '00:1A:11': 'Google, Inc',
  '3C:5A:B4': 'Google, Inc',
  'F4:F5:E8': 'Google, Inc',
  'DC:A6:32': 'Raspberry Pi Trading Ltd',
  'B8:27:EB': 'Raspberry Pi Foundation',
  'E4:5F:01': 'Raspberry Pi Trading Ltd',
  '00:50:56': 'VMware, Inc',
  '00:0C:29': 'VMware, Inc',
  '52:54:00': 'QEMU / KVM (libvirt)',
  '00:1B:21': 'Intel Corporate',
  '3C:97:0E': 'Wistron InfoComm',
  'AC:DE:48': 'Private',
  'F0:18:98': 'Apple, Inc',
  'A4:83:E7': 'Apple, Inc',
  'DC:A4:CA': 'Apple, Inc',
  '00:1D:7E': 'Cisco-Linksys, LLC',
  '70:4C:A5': 'TP-LINK Technologies',
  'D8:0D:17': 'TP-LINK Technologies',
  'EC:08:6B': 'TP-LINK Technologies',
  'B0:BE:76': 'TP-LINK Technologies',
  '00:11:32': 'Synology Incorporated',
  '54:04:A6': 'ASUSTek Computer Inc',
  '2C:FD:A1': 'ASUSTek Computer Inc',
  '00:E0:4C': 'Realtek Semiconductor',
  '60:38:E0': 'Belkin International',
  'EC:FA:BC': 'Espressif (ESP/IoT)',
  '24:62:AB': 'Espressif (ESP/IoT)',
  '7C:9E:BD': 'Espressif (ESP/IoT)',
};

/** Look up a vendor from a MAC address using its 24-bit OUI prefix. */
export function vendorForMac(mac: string | undefined): string | undefined {
  if (!mac) return undefined;
  const oui = mac.toUpperCase().replace(/-/g, ':').split(':').slice(0, 3).join(':');
  return OUI_VENDORS[oui];
}

/** A tiny built-in starter blocklist so filtering works before any gravity fetch. */
export const STARTER_BLOCKLIST: string[] = [
  'ads.doubleclick.net',
  'doubleclick.net',
  'googleadservices.com',
  'google-analytics.com',
  'www.google-analytics.com',
  'ssl.google-analytics.com',
  'googlesyndication.com',
  'pagead2.googlesyndication.com',
  'adservice.google.com',
  'ads.youtube.com',
  'analytics.tiktok.com',
  'graph.facebook.com',
  'connect.facebook.net',
  'an.facebook.com',
  'ads.facebook.com',
  'app-measurement.com',
  'firebaselogging-pa.googleapis.com',
  'metrics.icloud.com',
  'ads.yahoo.com',
  'analytics.yahoo.com',
  'scorecardresearch.com',
  'b.scorecardresearch.com',
  'adnxs.com',
  'ib.adnxs.com',
  'doubleverify.com',
  'criteo.com',
  'static.criteo.net',
  'taboola.com',
  'trc.taboola.com',
  'outbrain.com',
  'mc.yandex.ru',
  'hotjar.com',
  'static.hotjar.com',
  'bat.bing.com',
  'ad.doubleclick.net',
  'stats.g.doubleclick.net',
];

/** Public gravity sources registered by default (pulled on a gravity rebuild). */
export const DEFAULT_ADLISTS: string[] = [
  'https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts',
  'https://raw.githubusercontent.com/anudeepND/blacklist/master/adservers.txt',
];
