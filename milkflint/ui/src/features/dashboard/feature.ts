import { LayoutDashboardIcon } from 'lucide-react';
import { lazyPage } from '../lazy-page';
import type { Feature } from '../types';

export const feature = {
  id: 'dashboard',
  title: 'Dashboard',
  description: 'Everything at a glance, live.',
  icon: LayoutDashboardIcon,
  order: 0,
  page: lazyPage(() => import('./page'), (m) => m.DashboardPage),
} satisfies Feature;
