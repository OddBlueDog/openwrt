import { ZapIcon } from 'lucide-react';
import { lazyPage } from '../lazy-page';
import type { Feature } from '../types';

export const feature = {
  id: 'tuning',
  title: 'Performance Tuning',
  description: 'Packet steering and the Wi-Fi queue.',
  icon: ZapIcon,
  group: 'flow-control',
  order: 30,
  page: lazyPage(() => import('./page'), (m) => m.TuningPage),
} satisfies Feature;
