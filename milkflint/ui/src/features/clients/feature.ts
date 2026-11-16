import { MonitorSmartphoneIcon } from 'lucide-react';
import { lazyPage } from '../lazy-page';
import type { Feature } from '../types';

export const feature = {
  id: 'clients',
  title: 'All devices',
  description: 'Every device on your network: rename one, fix its address, block it.',
  icon: MonitorSmartphoneIcon,
  group: 'devices',
  order: 10,
  page: lazyPage(
    () => import('./page'),
    (m) => m.ClientsPage,
  ),
} satisfies Feature;
