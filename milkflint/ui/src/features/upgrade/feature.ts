import { CloudUploadIcon } from 'lucide-react';
import { lazyPage } from '../lazy-page';
import type { Feature } from '../types';

export const feature = {
  id: 'upgrade',
  title: 'Upgrade',
  description: 'Install a new firmware image.',
  icon: CloudUploadIcon,
  group: 'system',
  order: 18,
  page: lazyPage(() => import('./page'), (m) => m.UpgradePage),
} satisfies Feature;
