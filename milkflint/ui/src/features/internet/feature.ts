import { GlobeIcon } from 'lucide-react';
import { lazyPage } from '../lazy-page';
import type { Feature } from '../types';

export const feature = {
  id: 'internet',
  title: 'Internet',
  description: 'How the router connects to your provider, and which DNS it uses.',
  icon: GlobeIcon,
  order: 10,
  routerOnly: true,
  page: lazyPage(() => import('./page'), (m) => m.InternetPage),
} satisfies Feature;
