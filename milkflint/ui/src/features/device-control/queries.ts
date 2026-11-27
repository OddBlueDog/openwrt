// What the Device control page reads and does (see ARCHITECTURE.md): the
// groups and devices with their firewall rules, what the router has now
// (pauses, extra time, its clock) every 15 s, and this device's own address;
// a pause, extra time and resuming are set on the router at once.
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { type LiveQuery, liveQuery, type RouterQuery, settingsQuery } from '@/lib/query/options';
import { type DcData, type DcStatus, getStatus, giveExtra, loadDeviceControl, pause, resume, whoAmI } from './api';

export const deviceControlQueries = {
  settings: (): RouterQuery<DcData> => settingsQuery(['device-control', 'settings'], loadDeviceControl),
  /** pauses, extra time, the clock, what's online and used today: every 15 s */
  status: (): LiveQuery<DcStatus> => liveQuery(['device-control', 'status'], getStatus, 15_000),
  /** this device's own address, to warn before it cuts itself off */
  me: (): RouterQuery<{ ip?: string | undefined; mac?: string | undefined }> => settingsQuery(['device-control', 'me'], whoAmI),
};

/** A pause, extra time or resuming: the status reads again once it's done, whether it went through or not. */
function useOverride<V>(run: (v: V) => Promise<void>): UseMutationResult<void, Error, V> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSettled: () => client.invalidateQueries({ queryKey: deviceControlQueries.status().queryKey }),
  });
}

/** Pause devices until a time (null: until resumed). */
export function usePause(): UseMutationResult<void, Error, { macs: readonly string[]; until: number | null }> {
  return useOverride(({ macs, until }: { macs: readonly string[]; until: number | null }) => pause(macs, until));
}

/** Give devices extra time until a time. */
export function useGiveExtra(): UseMutationResult<void, Error, { macs: readonly string[]; until: number }> {
  return useOverride(({ macs, until }: { macs: readonly string[]; until: number }) => giveExtra(macs, until));
}

/** End devices' pause or extra time: their times apply again. */
export function useResume(): UseMutationResult<void, Error, readonly string[]> {
  return useOverride((macs: readonly string[]) => resume(macs));
}
