import { ShieldXIcon } from 'lucide-react';
import { lazyPage } from '../lazy-page';
import type { Feature } from '../types';

export const feature = {
  id: 'banip',
  title: 'banIP',
  description: 'Blocks addresses known for attacks, and any you choose, at the router.',
  icon: ShieldXIcon,
  group: 'security',
  order: 30,
  routerOnly: true,
  page: lazyPage(() => import('./page'), (m) => m.BanipPage),
} satisfies Feature;
