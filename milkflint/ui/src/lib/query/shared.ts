// Reads several features make the same way, under one key, so they share
// one cache entry (see ARCHITECTURE.md).
import { getSeen, type Seen } from '@/lib/api/seen';
import { type RouterQuery, settingsQuery } from './options';

export const sharedQueries = {
  /** when each device was first seen (milkflint.devices seen): All devices and Data usage */
  seen: (): RouterQuery<Seen> => settingsQuery(['devices', 'seen'], getSeen),
};
