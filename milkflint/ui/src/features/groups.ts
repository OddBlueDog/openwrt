import {
  GaugeIcon,
  GlobeLockIcon,
  MonitorSmartphoneIcon,
  NetworkIcon,
  SettingsIcon,
  ShieldIcon,
  SlidersHorizontalIcon,
  WifiIcon,
} from 'lucide-react';
import type { Group } from './types';

// The menu, by task: what people do every day first, then what they set up
// once, then the router itself. Top-level pages (Home, Internet) share the
// order scale with the groups.
export const groups: readonly Group[] = [
  { id: 'devices', title: 'Devices', icon: MonitorSmartphoneIcon, order: 10, band: 'everyday' },
  { id: 'wifi', title: 'Wi-Fi', icon: WifiIcon, order: 20, band: 'everyday' },
  { id: 'speed', title: 'Speed & latency', icon: GaugeIcon, order: 40, band: 'everyday' },
  { id: 'network', title: 'Network', icon: NetworkIcon, order: 50, band: 'setup' },
  { id: 'security', title: 'Security', icon: ShieldIcon, order: 60, band: 'setup' },
  { id: 'vpn', title: 'VPN', icon: GlobeLockIcon, order: 70, band: 'setup' },
  { id: 'system', title: 'System', icon: SettingsIcon, order: 80, band: 'router' },
  { id: 'advanced', title: 'Advanced', icon: SlidersHorizontalIcon, order: 90, band: 'router' },
];
