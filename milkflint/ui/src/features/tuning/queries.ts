// What Performance tuning reads (see ARCHITECTURE.md), and whether WED is
// on, which the Smart Queue, Wi-Fi, Guest Wi-Fi and Firewall pages read too.
import { type LiveQuery, liveQuery, type RouterQuery, settingsQuery } from '@/lib/query/options';
import { getLogSettings, type LogSettings } from '../logs/api';
import { getTuningStatus, loadTuning, loadWed, type TuningStatus } from './api';
import type { TuningData } from './model';
import type { WedConfig } from './wed';

export const tuningQueries = {
  settings: (): RouterQuery<TuningData> => settingsQuery(['tuning', 'settings'], loadTuning),
  /** what the settings are doing now, every 5 s */
  status: (): LiveQuery<TuningStatus> => liveQuery(['tuning', 'status'], getTuningStatus, 5000),
  /** the diagnostics' switches, which live with the Logs page's settings */
  logSettings: (): RouterQuery<LogSettings> => settingsQuery(['tuning', 'log-settings'], getLogSettings),
  /** what hardware offloading with WED reads and changes */
  wed: (): RouterQuery<WedConfig> => settingsQuery(['tuning', 'wed'], loadWed),
};
