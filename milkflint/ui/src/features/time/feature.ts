import { ClockIcon } from 'lucide-react';
import { lazyPage } from '../lazy-page';
import type { Feature } from '../types';

export const feature = {
  id: 'time',
  title: 'Name & Time',
  description: "The router's name, time zone and clock.",
  icon: ClockIcon,
  group: 'system',
  order: 20,
  page: lazyPage(() => import('./page'), (m) => m.TimePage),
} satisfies Feature;
