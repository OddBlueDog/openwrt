// What the radar scan reads and does (see ARCHITECTURE.md). A scan is a
// mutation; its status, a live query, then follows it.
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { type LiveQuery, liveQuery } from '@/lib/query/options';
import {
  type BlockRequest,
  type ChipReport,
  getChipReports,
  getScanStatus,
  loadRadio,
  type Radio,
  type ScanStatus,
  startScan,
  stopScan,
} from './api';

export const radarQueries = {
  /** the 5 GHz radio and its radar state, every 30 s */
  radio: (): LiveQuery<Radio | null> => liveQuery(['radar-scan', 'radio'], loadRadio, 30_000),
  /** the scan's state, every `every` ms (each second while one runs) */
  status: (every: number): LiveQuery<ScanStatus> => liveQuery(['radar-scan', 'status'], getScanStatus, every),
  /** the chip's last radar reports for `phy` (none without a radio), every 15 s */
  reports: (phy: string | undefined): LiveQuery<ChipReport[] | null> =>
    liveQuery(
      ['radar-scan', 'reports', phy ?? ''],
      () => (phy === undefined ? Promise.resolve(null) : getChipReports(phy)),
      15_000,
    ),
};

export interface StartScan {
  radio: string;
  phy: string;
  blocks: readonly BlockRequest[];
  seconds: number;
}

/** Start a scan; its status is asked again at once. */
export function useStartRadarScan(): UseMutationResult<void, Error, StartScan> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ radio, phy, blocks, seconds }: StartScan) => startScan(radio, phy, blocks, seconds),
    onSuccess: () => client.invalidateQueries({ queryKey: ['radar-scan', 'status'] }),
  });
}

/** Stop the scan and bring 5 GHz back; its status is asked again at once. */
export function useStopRadarScan(): UseMutationResult<void, Error, void> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: stopScan,
    onSettled: () => client.invalidateQueries({ queryKey: ['radar-scan', 'status'] }),
  });
}
