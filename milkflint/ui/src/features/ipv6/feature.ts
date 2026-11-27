import { Globe2Icon } from 'lucide-react';
import { lazyPage } from '../lazy-page';
import type { Feature } from '../types';
import { ipv6Queries } from './queries';

export const feature = {
  id: 'ipv6',
  title: 'IPv6',
  description: 'IPv6 from your provider, and how devices get their addresses.',
  icon: Globe2Icon,
  group: 'network',
  order: 20,
  routerOnly: true,
  page: lazyPage(
    () => import('./page'),
    (m) => m.Ipv6Page,
  ),
  prefetch: (client) => {
    client.query(ipv6Queries.settings()).catch(() => undefined);
  },
} satisfies Feature;
