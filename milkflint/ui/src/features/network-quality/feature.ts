import { RadarIcon } from 'lucide-react';
import { lazyPage } from '../lazy-page';
import type { Feature } from '../types';

export const feature = {
  id: 'network-quality',
  title: 'Network Quality',
  description: 'Latency to your gateway, the internet and DNS, measured continuously.',
  icon: RadarIcon,
  group: 'flow-control',
  order: 10,
  page: lazyPage(() => import('./page'), (m) => m.NetworkQualityPage),
} satisfies Feature;
