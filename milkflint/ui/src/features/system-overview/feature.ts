import { RouterIcon } from 'lucide-react';
import { lazyPage } from '../lazy-page';
import type { Feature } from '../types';

export const feature = {
  id: 'system-overview',
  title: 'Overview',
  description: 'The router itself: hardware, firmware and resources.',
  icon: RouterIcon,
  group: 'system',
  order: 10,
  page: lazyPage(() => import('./page'), (m) => m.SystemOverviewPage),
} satisfies Feature;
