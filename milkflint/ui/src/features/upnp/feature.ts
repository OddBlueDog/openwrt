import { PlugZapIcon } from 'lucide-react';
import { lazyPage } from '../lazy-page';
import type { Feature } from '../types';

export const feature = {
  id: 'upnp',
  title: 'UPnP',
  description: 'Let games and apps open ports themselves (UPnP and NAT-PMP).',
  icon: PlugZapIcon,
  group: 'security',
  order: 40,
  routerOnly: true,
  page: lazyPage(() => import('./page'), (m) => m.UpnpPage),
} satisfies Feature;
