import { UsersIcon } from 'lucide-react';
import { lazyPage } from '../lazy-page';
import type { Feature } from '../types';

export const feature = {
  id: 'wifi-guest',
  title: 'Guest Wi-Fi',
  description: 'Networks of their own for visitors and smart-home devices: the internet, but none of your devices.',
  icon: UsersIcon,
  group: 'wifi',
  order: 20,
  page: lazyPage(() => import('./page'), (m) => m.GuestWifiPage),
} satisfies Feature;
