import { SmartphoneIcon } from 'lucide-react';
import { lazyPage } from '../lazy-page';
import type { Feature } from '../types';

export const feature = {
  id: 'remote-access',
  title: 'Remote access',
  description: 'Reach home from anywhere: phones and laptops connect to this router with WireGuard.',
  icon: SmartphoneIcon,
  group: 'vpn',
  order: 10,
  page: lazyPage(() => import('./page'), (m) => m.RemoteAccessPage),
} satisfies Feature;
