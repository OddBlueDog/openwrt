import { LockIcon } from 'lucide-react';
import { lazyPage } from '../lazy-page';
import type { Feature } from '../types';

export const feature = {
  id: 'https',
  title: 'HTTPS',
  description: 'An encrypted connection to this page and LuCI.',
  icon: LockIcon,
  group: 'system',
  order: 16,
  page: lazyPage(() => import('./page'), (m) => m.HttpsPage),
} satisfies Feature;
