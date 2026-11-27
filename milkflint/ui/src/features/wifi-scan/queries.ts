// What Nearby networks reads and does (see ARCHITECTURE.md). A scan is a
// mutation; the scan's state, a live query, then follows it.
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { getRegulatory, type RegRule } from '@/lib/api/wireless';
import { type LiveQuery, liveQuery } from '@/lib/query/options';
import { getScan, loadRadios, type ScanState, startScan } from './api';
import type { Radio } from './model';

export const wifiScanQueries = {
  /** this router's radios as they run now, every 30 s */
  radios: (): LiveQuery<Radio[]> => liveQuery(['wifi-scan', 'radios'], loadRadios, 30_000),
  /** the last scan, every `every` ms (each second while one runs) */
  scan: (every: number): LiveQuery<ScanState> => liveQuery(['wifi-scan', 'scan'], getScan, every),
  /** the country's channel rules, read once an hour; not read until the country is known */
  regulatory: (country: string | undefined): LiveQuery<{ dfs_region: string; rules: RegRule[] }> => ({
    ...liveQuery(['wifi-scan', 'regulatory', country ?? ''], () => getRegulatory(country ?? ''), 3_600_000),
    enabled: country !== undefined,
  }),
};

/** Scan these radios (phys); the scan's state is asked again at once. */
export function useStartWifiScan(): UseMutationResult<void, Error, readonly string[]> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (phys: readonly string[]) => startScan(phys),
    onSuccess: () => client.invalidateQueries({ queryKey: ['wifi-scan', 'scan'] }),
  });
}
