import { ShieldBanIcon } from 'lucide-react';
import { lazyPage } from '../lazy-page';
import type { Feature } from '../types';

export const feature = {
  id: 'adguardhome',
  title: 'AdGuard Home',
  description: 'Ad and tracker blocking for every device, set up in its own web interface.',
  icon: ShieldBanIcon,
  group: 'security',
  order: 40,
  routerOnly: true,
  page: lazyPage(
    () => import('./page'),
    (m) => m.AdGuardHomePage,
  ),
} satisfies Feature;
