import { ChartColumnIcon } from 'lucide-react';
import { lazyPage } from '../lazy-page';
import type { Feature } from '../types';

export const feature = {
  id: 'data-statistics',
  title: 'Data Statistics',
  description: 'How much each device downloads and uploads, and on what.',
  icon: ChartColumnIcon,
  group: 'flow-control',
  order: 15,
  page: lazyPage(() => import('./page'), (m) => m.DataStatisticsPage),
} satisfies Feature;
