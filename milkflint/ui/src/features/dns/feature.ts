import { ServerIcon } from 'lucide-react';
import { lazyPage } from '../lazy-page';
import type { Feature } from '../types';
import { dnsQueries } from './queries';

export const feature = {
  id: 'dns',
  title: 'DNS',
  description: 'Encrypted DNS, protection, and names on your network.',
  icon: ServerIcon,
  group: 'network',
  order: 10,
  routerOnly: true,
  page: lazyPage(
    () => import('./page'),
    (m) => m.DnsPage,
  ),
  prefetch: (client) => {
    client.query(dnsQueries.settings()).catch(() => undefined);
  },
} satisfies Feature;
