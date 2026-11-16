import { LockIcon } from 'lucide-react';
import { lazyPage } from '../lazy-page';
import type { Feature } from '../types';

// folded into Router access (admin-password): the route opens its HTTPS card
export const feature = {
  id: 'https',
  title: 'HTTPS',
  description: 'An encrypted connection to this page and LuCI.',
  icon: LockIcon,
  group: 'security',
  order: 70,
  inMenu: false,
  page: lazyPage(
    () => import('./page'),
    (m) => m.HttpsPage,
  ),
} satisfies Feature;
