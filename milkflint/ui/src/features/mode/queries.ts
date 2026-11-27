// What the Operating mode page reads and writes (see ARCHITECTURE.md).
import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import { type LiveQuery, liveQuery, type RouterQuery, settingsQuery } from '@/lib/query/options';
import { getModeStatus, type ModeStatus, switchMode } from './api';
import type { ApRequest } from './model';

/** How often a switch under way is followed. */
export const FOLLOW_MS = 2000;

export const modeQueries = {
  status: (): RouterQuery<ModeStatus> => settingsQuery(['mode', 'status'], getModeStatus),
  /** the status while a switch runs, every 2 s; asks nothing while `on` is false */
  following: (on: boolean): LiveQuery<ModeStatus> => ({
    ...liveQuery(['mode', 'status', 'following'], getModeStatus, FOLLOW_MS),
    enabled: on,
  }),
};

/** Start a switch; the router answers with when it started and how long it takes at most. */
export function useSwitchMode(): UseMutationResult<{ at: number; seconds: number }, Error, ApRequest | { mode: 'router' }> {
  return useMutation({ mutationFn: switchMode });
}
