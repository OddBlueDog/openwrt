import { NetworkIcon } from 'lucide-react';
import { lazyPage } from '../lazy-page';
import type { Feature } from '../types';

export const feature = {
  id: 'lan',
  title: 'LAN',
  description: "The router's own address, and the addresses it hands out to your devices.",
  icon: NetworkIcon,
  group: 'network',
  order: 10,
  page: lazyPage(() => import('./page'), (m) => m.LanPage),
} satisfies Feature;
