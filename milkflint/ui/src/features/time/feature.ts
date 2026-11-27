import { ClockIcon } from 'lucide-react';
import { lazyPage } from '../lazy-page';
import type { Feature } from '../types';
import { timeQueries } from './queries';

export const feature = {
  id: 'time',
  title: 'Name & time',
  description: "The router's name, time zone and clock.",
  icon: ClockIcon,
  group: 'system',
  order: 40,
  page: lazyPage(
    () => import('./page'),
    (m) => m.TimePage,
  ),
  prefetch: (client) => {
    client.query(timeQueries.settings()).catch(() => undefined);
  },
} satisfies Feature;
