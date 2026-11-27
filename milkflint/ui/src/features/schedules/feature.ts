import { CalendarClockIcon } from 'lucide-react';
import { lazyPage } from '../lazy-page';
import type { Feature } from '../types';
import { schedulesQueries } from './queries';

export const feature = {
  id: 'schedules',
  title: 'Scheduled tasks',
  description: 'Restart the router, turn Wi-Fi off and on, or run your own commands, at set times (root’s crontab).',
  icon: CalendarClockIcon,
  group: 'system',
  order: 50,
  page: lazyPage(
    () => import('./page'),
    (m) => m.SchedulesPage,
  ),
  prefetch: (client) => {
    client.query(schedulesQueries.crontab()).catch(() => undefined);
  },
} satisfies Feature;
