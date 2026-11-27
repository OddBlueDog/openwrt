import { CpuIcon } from 'lucide-react';
import { lazyPage } from '../lazy-page';
import type { Feature } from '../types';
import { driverQueries } from './queries';

export const feature = {
  id: 'wifi-driver',
  title: 'Wi-Fi driver',
  description: 'How the Wi-Fi driver shares the air between devices: airtime, wake times, spatial reuse and more.',
  icon: CpuIcon,
  group: 'advanced',
  order: 20,
  page: lazyPage(
    () => import('./page'),
    (m) => m.WifiDriverPage,
  ),
  prefetch: (client) => {
    client.query(driverQueries.settings()).catch(() => undefined);
  },
} satisfies Feature;
