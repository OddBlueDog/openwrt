import { Globe2Icon } from 'lucide-react';
import { lazyPage } from '../lazy-page';
import type { Feature } from '../types';

export const feature = {
  id: 'ipv6',
  title: 'IPv6',
  description: 'IPv6 from your provider, and how devices get their addresses.',
  icon: Globe2Icon,
  group: 'network',
  order: 20,
  page: lazyPage(() => import('./page'), (m) => m.Ipv6Page),
} satisfies Feature;
