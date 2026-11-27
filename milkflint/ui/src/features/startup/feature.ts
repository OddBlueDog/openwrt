import { PowerIcon } from 'lucide-react';
import { lazyPage } from '../lazy-page';
import type { Feature } from '../types';

export const feature = {
  id: 'startup',
  title: 'Startup',
  description:
    'The services the router runs: start, stop or restart one, turn it on or off at boot, and your own commands at boot.',
  icon: PowerIcon,
  group: 'system',
  order: 55,
  page: lazyPage(
    () => import('./page'),
    (m) => m.StartupPage,
  ),
} satisfies Feature;
