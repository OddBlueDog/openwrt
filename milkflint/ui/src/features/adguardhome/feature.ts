import { ShieldBanIcon } from 'lucide-react';
import { lazyPage } from '../lazy-page';
import type { Feature } from '../types';
import { adguardQueries } from './queries';

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
  prefetch: (client) => {
    client.query(adguardQueries.around()).catch(() => undefined);
  },
} satisfies Feature;
