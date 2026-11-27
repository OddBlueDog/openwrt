// What the Smart Queue page reads (see ARCHITECTURE.md). Its live view is
// the shared network reading (hooks/use-network-live, ./live.ts).
import { type RouterQuery, settingsQuery } from '@/lib/query/options';
import { loadSqm } from './api';
import type { SqmData } from './model';

export const sqmQueries = {
  settings: (): RouterQuery<SqmData> => settingsQuery(['sqm', 'settings'], loadSqm),
};
