import { ChartColumnIcon } from 'lucide-react';
import { lazyPage } from '../lazy-page';
import type { Feature } from '../types';

export const feature = {
  id: 'data-statistics',
  title: 'Data usage',
  description: 'How much each device downloads and uploads, and on what.',
  icon: ChartColumnIcon,
  group: 'devices',
  order: 20,
  routerOnly: true,
  page: lazyPage(
    () => import('./page'),
    (m) => m.DataStatisticsPage,
  ),
} satisfies Feature;
