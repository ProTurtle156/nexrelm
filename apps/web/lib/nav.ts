import {
  LayoutDashboard,
  Globe,
  Router,
  UsersRound,
  Server,
  ShieldHalf,
  Network,
  ScrollText,
  Settings,
  type LucideIcon,
} from 'lucide-react';
import type { ModuleKey } from '@nexrelm/types';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  module?: ModuleKey;
  hint: string;
}

export const NAV: NavItem[] = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard, hint: 'Command deck & live map' },
  { href: '/dns', label: 'DNS', icon: Globe, module: 'dns', hint: 'Zones & resolver' },
  { href: '/dhcp', label: 'DHCP', icon: Router, module: 'dhcp', hint: 'Scopes & leases' },
  { href: '/directory', label: 'Directory', icon: UsersRound, module: 'directory', hint: 'AD / Kerberos realm' },
  { href: '/virtualization', label: 'Virtualization', icon: Server, module: 'virtualization', hint: 'Hosts & VMs' },
  { href: '/security', label: 'Security', icon: ShieldHalf, module: 'security', hint: 'Threats & firewall' },
  { href: '/gateway', label: 'Gateway', icon: Network, hint: 'Network edge & routing' },
  { href: '/logs', label: 'Logs', icon: ScrollText, hint: 'Live event stream' },
  { href: '/settings', label: 'Settings', icon: Settings, hint: 'Modules & connection' },
];
