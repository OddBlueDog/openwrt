import { NetworkIcon } from 'lucide-react';
import { lazyPage } from '../lazy-page';
import type { Feature } from '../types';
import { lanQueries } from './queries';

export const feature = {
  id: 'lan',
  title: 'LAN & DHCP',
  description: "The router's address, the addresses it hands out, and who is talking now.",
  icon: NetworkIcon,
  group: 'network',
  order: 30,
  routerOnly: true,
  page: lazyPage(
    () => import('./page'),
    (m) => m.LanPage,
  ),
  prefetch: (client) => {
    client.query(lanQueries.settings()).catch(() => undefined);
  },
} satisfies Feature;
