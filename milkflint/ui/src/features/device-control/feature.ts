import { ShieldUserIcon } from 'lucide-react';
import { lazyPage } from '../lazy-page';
import type { Feature } from '../types';

export const feature = {
  id: 'device-control',
  title: 'Device control',
  description: 'When each person’s devices may use the internet: bedtimes, school hours, a pause for dinner.',
  icon: ShieldUserIcon,
  group: 'devices',
  order: 15,
  routerOnly: true,
  page: lazyPage(
    () => import('./page'),
    (m) => m.DeviceControlPage,
  ),
} satisfies Feature;
