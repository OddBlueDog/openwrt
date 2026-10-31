import { RouterIcon } from 'lucide-react';
import { lazyPage } from '../lazy-page';
import type { Feature } from '../types';

export const feature = {
  id: 'mode',
  title: 'Operating Mode',
  description: "MilkFlint as your main router, or as an access point on another router's network.",
  icon: RouterIcon,
  group: 'network',
  order: 5,
  page: lazyPage(() => import('./page'), (m) => m.ModePage),
} satisfies Feature;
