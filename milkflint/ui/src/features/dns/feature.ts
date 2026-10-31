import { ServerIcon } from 'lucide-react';
import { lazyPage } from '../lazy-page';
import type { Feature } from '../types';

export const feature = {
  id: 'dns',
  title: 'DNS',
  description: 'Encrypted DNS, protection, and names on your network.',
  icon: ServerIcon,
  order: 15,
  routerOnly: true,
  page: lazyPage(() => import('./page'), (m) => m.DnsPage),
} satisfies Feature;
