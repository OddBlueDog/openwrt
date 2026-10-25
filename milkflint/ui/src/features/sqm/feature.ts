import { GaugeIcon } from 'lucide-react';
import { lazyPage } from '../lazy-page';
import type { Feature } from '../types';

export const feature = {
  id: 'sqm',
  title: 'Smart Queue',
  description: 'Keep latency low when the line is busy (SQM with CAKE).',
  icon: GaugeIcon,
  group: 'flow-control',
  order: 20,
  page: lazyPage(() => import('./page'), (m) => m.SqmPage),
} satisfies Feature;
