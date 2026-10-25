import { RadarIcon } from 'lucide-react';
import { lazyPage } from '../lazy-page';
import type { Feature } from '../types';

export const feature = {
  id: 'wifi-scan',
  title: 'Nearby Networks',
  description: 'The Wi-Fi around the router: who’s on your channels, and which are quietest.',
  icon: RadarIcon,
  group: 'wifi',
  order: 30,
  page: lazyPage(() => import('./page'), (m) => m.NearbyPage),
} satisfies Feature;
