import { MonitorSmartphoneIcon } from 'lucide-react';
import { lazyPage } from '../lazy-page';
import type { Feature } from '../types';

export const feature = {
  id: 'clients',
  title: 'Clients',
  description: 'Devices on your network.',
  icon: MonitorSmartphoneIcon,
  order: 30,
  page: lazyPage(() => import('./page'), (m) => m.ClientsPage),
} satisfies Feature;
