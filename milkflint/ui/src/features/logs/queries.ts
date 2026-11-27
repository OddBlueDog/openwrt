// What the Logs page reads (see ARCHITECTURE.md).
import { type LiveQuery, liveQuery, type RouterQuery, settingsQuery } from '@/lib/query/options';
import { getLogSettings, getLogStatus, type LogKind, type LogLines, type LogStatus, readLog } from './api';
import type { LogSettings } from './model';

export const logsQueries = {
  /** the last `lines` lines of a log: every 5 s while followed, else hourly */
  log: (kind: LogKind, lines: number, follow: boolean): LiveQuery<LogLines> =>
    liveQuery(['logs', 'log', kind, lines], () => readLog(kind, lines), follow ? 5000 : 3_600_000),
  /** where each log is and what's on, every 15 s */
  status: (): LiveQuery<LogStatus> => liveQuery(['logs', 'status'], getLogStatus, 15_000),
  settings: (): RouterQuery<LogSettings> => settingsQuery(['logs', 'settings'], getLogSettings),
};
