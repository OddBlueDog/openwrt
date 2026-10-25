import { ArchiveRestoreIcon } from 'lucide-react';
import { lazyPage } from '../lazy-page';
import type { Feature } from '../types';

export const feature = {
  id: 'backup-reset',
  title: 'Backup & Reset',
  description: 'Save your settings, restart, or go back to factory settings.',
  icon: ArchiveRestoreIcon,
  group: 'system',
  order: 80,
  page: lazyPage(() => import('./page'), (m) => m.BackupResetPage),
} satisfies Feature;
