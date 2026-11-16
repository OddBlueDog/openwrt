import { ZapIcon } from 'lucide-react';
import { lazyPage } from '../lazy-page';
import type { Feature } from '../types';

export const feature = {
  id: 'tuning',
  title: 'Performance tuning',
  description: 'Packet steering, flow offloading, the Wi-Fi queue and diagnostics.',
  icon: ZapIcon,
  group: 'advanced',
  order: 10,
  page: lazyPage(
    () => import('./page'),
    (m) => m.TuningPage,
  ),
} satisfies Feature;
