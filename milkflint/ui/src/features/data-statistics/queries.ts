// What the Data usage page reads (see ARCHITECTURE.md).
import { sharedQueries } from '@/lib/query/shared';
import { loadNames } from '@/lib/api/names';
import { type LiveQuery, liveQuery, type RouterQuery, settingsQuery } from '@/lib/query/options';
import { type DataUsageSettings, getPeriods, getUsage, loadRouterIps, loadSettings, type UsageRow } from './api';
import { getHistory, type History, HISTORY_POLL_MS } from './history';

export type Periods = Awaited<ReturnType<typeof getPeriods>>;

export const dataUsageQueries = {
  settings: (): RouterQuery<DataUsageSettings> => settingsQuery(['data-statistics', 'settings'], loadSettings),
  /** the accounting periods, and whether nlbwmon is there and counting */
  periods: (): LiveQuery<Periods> => liveQuery(['data-statistics', 'periods'], getPeriods, 300_000),
  names: (): LiveQuery<Map<string, string>> => liveQuery(['data-statistics', 'names'], loadNames, 60_000),
  routerIps: (): LiveQuery<Set<string>> => liveQuery(['data-statistics', 'router-ips'], loadRouterIps, 300_000),
  /** a period's counts by device ('mac') or application ('layer7'); '' is the current period */
  usage: (period: string, group: 'mac' | 'layer7'): LiveQuery<UsageRow[]> =>
    liveQuery(['data-statistics', 'usage', period, group], () => getUsage(period, group), 30_000),
  /** when the router first saw each device: read once the page opens */
  seen: sharedQueries.seen,
  /** the last 24 hours, every device's or one's; the router has something new every 5 minutes */
  history: (mac: string | undefined): LiveQuery<History> =>
    liveQuery(['data-statistics', 'history', mac ?? ''], () => getHistory(mac), HISTORY_POLL_MS),
};
