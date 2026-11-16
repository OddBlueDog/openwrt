import { SatelliteDishIcon } from 'lucide-react';
import { lazyPage } from '../lazy-page';
import type { Feature } from '../types';

export const feature = {
  id: 'radar-scan',
  title: 'Radar scan',
  description: 'Listen for radar on the 5 GHz radar channels, and see what the Wi-Fi chip makes of it.',
  icon: SatelliteDishIcon,
  group: 'wifi',
  order: 40,
  // a tab of Nearby networks (#/wifi-scan/radar); this address opens it
  inMenu: false,
  page: lazyPage(
    () => import('./page'),
    (m) => m.RadarScanPage,
  ),
} satisfies Feature;
