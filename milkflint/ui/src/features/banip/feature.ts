import { ShieldXIcon } from 'lucide-react';
import { lazyPage } from '../lazy-page';
import type { Feature } from '../types';
import { banipQueries } from './queries';

export const feature = {
  id: 'banip',
  title: 'banIP',
  description: 'Blocks addresses known for attacks, and any you choose, at the router.',
  icon: ShieldXIcon,
  group: 'security',
  order: 50,
  routerOnly: true,
  page: lazyPage(
    () => import('./page'),
    (m) => m.BanipPage,
  ),
  prefetch: (client) => {
    client.query(banipQueries.config()).catch(() => undefined);
  },
} satisfies Feature;
