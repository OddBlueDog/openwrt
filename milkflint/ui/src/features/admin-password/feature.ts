import { KeyRoundIcon } from 'lucide-react';
import { lazyPage } from '../lazy-page';
import type { Feature } from '../types';

export const feature = {
  id: 'admin-password',
  title: 'Router access',
  description: 'The admin password for these pages, LuCI and SSH, and HTTPS with its certificate.',
  icon: KeyRoundIcon,
  group: 'security',
  order: 60,
  page: lazyPage(
    () => import('./page'),
    (m) => m.RouterAccessPage,
  ),
} satisfies Feature;
