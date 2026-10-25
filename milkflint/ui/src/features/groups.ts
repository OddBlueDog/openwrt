import { ActivityIcon, GlobeLockIcon, NetworkIcon, SettingsIcon, ShieldIcon, WifiIcon } from 'lucide-react';
import type { Group } from './types';

export const groups: readonly Group[] = [
  { id: 'wifi', title: 'Wi-Fi', icon: WifiIcon, order: 20 },
  { id: 'network', title: 'Network', icon: NetworkIcon, order: 40 },
  { id: 'vpn', title: 'VPN', icon: GlobeLockIcon, order: 45 },
  { id: 'flow-control', title: 'Flow Control', icon: ActivityIcon, order: 50 },
  { id: 'security', title: 'Security', icon: ShieldIcon, order: 60 },
  { id: 'system', title: 'System', icon: SettingsIcon, order: 70 },
];
