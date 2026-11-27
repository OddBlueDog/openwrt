import { RadarIcon } from 'lucide-react';
import { lazyPage } from '../lazy-page';
import type { Feature } from '../types';
import { qualityQueries } from './queries';

export const feature = {
  id: 'network-quality',
  title: 'Network quality',
  description: 'Latency to your gateway, the internet and DNS, measured continuously.',
  icon: RadarIcon,
  group: 'speed',
  order: 20,
  page: lazyPage(
    () => import('./page'),
    (m) => m.NetworkQualityPage,
  ),
  prefetch: (client) => {
    client.query(qualityQueries.settings()).catch(() => undefined);
  },
} satisfies Feature;
