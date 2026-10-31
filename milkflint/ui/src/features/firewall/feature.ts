import { BrickWallIcon } from 'lucide-react';
import { lazyPage } from '../lazy-page';
import type { Feature } from '../types';

export const feature = {
  id: 'firewall',
  title: 'Firewall',
  description: 'What can reach your network from the internet, and what your devices can reach.',
  icon: BrickWallIcon,
  group: 'security',
  order: 10,
  routerOnly: true,
  page: lazyPage(() => import('./page'), (m) => m.FirewallPage),
} satisfies Feature;
