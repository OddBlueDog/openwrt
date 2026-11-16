import { ArrowRightLeftIcon } from 'lucide-react';
import { lazyPage } from '../lazy-page';
import type { Feature } from '../types';

export const feature = {
  id: 'port-forwards',
  title: 'Port forwards',
  description: 'Let something on the internet reach a device at home, such as a game console or a camera.',
  icon: ArrowRightLeftIcon,
  group: 'security',
  order: 20,
  routerOnly: true,
  page: lazyPage(
    () => import('./page'),
    (m) => m.PortForwardsPage,
  ),
} satisfies Feature;
