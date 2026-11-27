// What Name & time reads and writes (see ARCHITECTURE.md).
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { type LiveQuery, liveQuery, type RouterQuery, settingsQuery } from '@/lib/query/options';
import { type ClockOffsets, clockOffsets, loadTime, setClockFromDevice } from './api';
import type { TimeData } from './model';

export const timeQueries = {
  settings: (): RouterQuery<TimeData> => settingsQuery(['time', 'settings'], loadTime),
  /** how far the router's clock is from this device's, every 30 s */
  clock: (): LiveQuery<ClockOffsets> => liveQuery(['time', 'clock'], clockOffsets, 30_000),
};

/** Set the router's clock from this device; the clock is read again. */
export function useSetClock(): UseMutationResult<void, Error, void> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: setClockFromDevice,
    onSuccess: () => client.invalidateQueries({ queryKey: timeQueries.clock().queryKey }),
  });
}
