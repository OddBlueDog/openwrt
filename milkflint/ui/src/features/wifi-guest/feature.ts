import { UsersIcon } from 'lucide-react';
import { lazyPage } from '../lazy-page';
import type { Feature } from '../types';
import { guestQueries } from './queries';

export const feature = {
  id: 'wifi-guest',
  title: 'Guest Wi-Fi',
  description: 'Networks of their own for visitors and smart-home devices: the internet, but none of your devices.',
  icon: UsersIcon,
  group: 'wifi',
  order: 20,
  routerOnly: true,
  page: lazyPage(
    () => import('./page'),
    (m) => m.GuestWifiPage,
  ),
  prefetch: (client) => {
    client.query(guestQueries.settings()).catch(() => undefined);
  },
} satisfies Feature;
