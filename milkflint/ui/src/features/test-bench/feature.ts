import { FlaskConicalIcon } from 'lucide-react';
import { lazyPage } from '../lazy-page';
import type { Feature } from '../types';

export const feature = {
  id: 'test-bench',
  title: 'Test Bench',
  description: 'Test the network from several devices at once, while the router records what it does.',
  icon: FlaskConicalIcon,
  group: 'flow-control',
  order: 12,
  page: lazyPage(() => import('./page'), (m) => m.TestBenchPage),
} satisfies Feature;
