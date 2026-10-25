import { ScrollTextIcon } from 'lucide-react';
import { lazyPage } from '../lazy-page';
import type { Feature } from '../types';

export const feature = {
  id: 'logs',
  title: 'Logs',
  description: 'The system, kernel, Wi-Fi and debug logs.',
  icon: ScrollTextIcon,
  group: 'system',
  order: 70,
  page: lazyPage(() => import('./page'), (m) => m.LogsPage),
} satisfies Feature;
