import { RadioTowerIcon } from 'lucide-react';
import { lazyPage } from '../lazy-page';
import type { Feature } from '../types';

export const feature = {
  id: 'wifi',
  title: 'Radios & SSIDs',
  description: 'Networks, passwords and radio settings for each band.',
  icon: RadioTowerIcon,
  group: 'wifi',
  order: 10,
  page: lazyPage(() => import('./page'), (m) => m.WifiPage),
} satisfies Feature;
