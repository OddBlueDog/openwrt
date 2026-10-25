import { KeyRoundIcon } from 'lucide-react';
import { lazyPage } from '../lazy-page';
import type { Feature } from '../types';

export const feature = {
  id: 'admin-password',
  title: 'Admin Password',
  description: 'The password for this page, LuCI and SSH.',
  icon: KeyRoundIcon,
  group: 'system',
  order: 15,
  page: lazyPage(() => import('./page'), (m) => m.AdminPasswordPage),
} satisfies Feature;
