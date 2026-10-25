import { CalendarClockIcon } from 'lucide-react';
import { lazyPage } from '../lazy-page';
import type { Feature } from '../types';

export const feature = {
  id: 'schedules',
  title: 'Scheduled Tasks',
  description: 'Restart the router, or turn Wi-Fi off and on, at set times.',
  icon: CalendarClockIcon,
  group: 'system',
  order: 30,
  page: lazyPage(() => import('./page'), (m) => m.SchedulesPage),
} satisfies Feature;
