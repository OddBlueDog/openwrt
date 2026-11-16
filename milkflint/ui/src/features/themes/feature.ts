import { PaletteIcon } from 'lucide-react';
import { lazyPage } from '../lazy-page';
import type { Feature } from '../types';

export const feature = {
  id: 'themes',
  title: 'Themes',
  description: 'Pick how the interface looks, or change a theme’s colours and keep your own.',
  icon: PaletteIcon,
  group: 'system',
  order: 70,
  page: lazyPage(
    () => import('./page'),
    (m) => m.ThemesPage,
  ),
} satisfies Feature;
