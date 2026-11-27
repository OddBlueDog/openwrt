// What the Wi-Fi driver page reads (see ARCHITECTURE.md).
import { type RouterQuery, settingsQuery } from '@/lib/query/options';
import { loadWifi } from '../wifi/load';

export type DriverData = Awaited<ReturnType<typeof loadWifi>>;

export const driverQueries = {
  /** every radio with its driver options, as Networks & radios' loader reads them for this page */
  settings: (): RouterQuery<DriverData> => settingsQuery(['wifi-driver', 'settings'], () => loadWifi('driver')),
};
