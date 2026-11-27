// What the Internet page reads (see ARCHITECTURE.md).
import { getInterfaces, type NetworkInterface } from '@/lib/api/network';
import { type LiveQuery, liveQuery, type RouterQuery, settingsQuery } from '@/lib/query/options';
import { loadInternet } from './api';
import type { InternetForm } from './model';

export const internetQueries = {
  settings: (): RouterQuery<InternetForm> => settingsQuery(['internet', 'settings'], loadInternet),
  /** the connection now, every 5 s */
  interfaces: (): LiveQuery<NetworkInterface[]> => liveQuery(['internet', 'interfaces'], getInterfaces, 5000),
};
