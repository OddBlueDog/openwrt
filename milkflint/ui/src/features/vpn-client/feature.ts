import { RouteIcon } from 'lucide-react';
import { lazyPage } from '../lazy-page';
import type { Feature } from '../types';

export const feature = {
  id: 'vpn-client',
  title: 'Send through a VPN',
  description: 'Send chosen devices’ internet traffic through a VPN provider’s WireGuard server.',
  icon: RouteIcon,
  group: 'vpn',
  order: 20,
  routerOnly: true,
  page: lazyPage(() => import('./page'), (m) => m.VpnClientPage),
} satisfies Feature;
