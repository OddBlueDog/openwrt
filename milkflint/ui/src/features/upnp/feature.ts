import { PlugZapIcon } from 'lucide-react';
import { lazyPage } from '../lazy-page';
import type { Feature } from '../types';
import { upnpQueries } from './queries';

export const feature = {
  id: 'upnp',
  title: 'UPnP',
  description: 'Let games and apps open ports themselves (UPnP and NAT-PMP).',
  icon: PlugZapIcon,
  group: 'security',
  order: 30,
  routerOnly: true,
  page: lazyPage(
    () => import('./page'),
    (m) => m.UpnpPage,
  ),
  prefetch: (client) => {
    client.query(upnpQueries.settings()).catch(() => undefined);
  },
} satisfies Feature;
