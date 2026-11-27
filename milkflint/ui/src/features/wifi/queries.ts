// What the Wi-Fi pages read and write (see ARCHITECTURE.md).
import { useMutation, type UseMutationResult, useQueryClient } from '@tanstack/react-query';
import { type AirtimeStatus, endTwt, getAirtime, getRegulatory, type RegRule } from '@/lib/api/wireless';
import { type LiveQuery, liveQuery, type RouterQuery, settingsQuery } from '@/lib/query/options';
import {
  type BeamformingBand,
  LIVE_POLL_MS,
  loadBeamformingBands,
  loadLiveSample,
  loadRadarBands,
  loadTwt,
  type LiveSample,
  type RadarBand,
  type TwtLoaded,
} from './api';
import { loadWifi } from './load';
import type { WifiData } from './model';

export const wifiQueries = {
  /** Networks & radios' settings: each band's network and radio */
  networks: (): RouterQuery<WifiData> => settingsQuery(['wifi', 'networks'], () => loadWifi('networks')),
  /** each band's live readings, every 3 s */
  live: (): LiveQuery<LiveSample> => liveQuery(['wifi', 'live'], loadLiveSample, LIVE_POLL_MS),
  /** what a country allows (it changes only with the country), every hour */
  regulatory: (country: string): LiveQuery<{ dfs_region: string; rules: RegRule[] }> =>
    liveQuery(['wifi', 'regulatory', country], () => getRegulatory(country), 3_600_000),
  /** what 5 GHz radar detection has heard and done, every 15 s */
  radar: (): LiveQuery<RadarBand[]> => liveQuery(['wifi', 'radar'], loadRadarBands, 15_000),
  /** what each band's beamforming runs with now, every 30 s */
  beamforming: (): LiveQuery<BeamformingBand[]> => liveQuery(['wifi', 'beamforming'], loadBeamformingBands, 30_000),
  /** Target Wake Time on each band now, every 15 s */
  twt: (): LiveQuery<TwtLoaded> => liveQuery(['wifi', 'twt'], loadTwt, 15_000),
  /** who's using the air on each band, every 2 s */
  airtime: (): LiveQuery<AirtimeStatus> => liveQuery(['wifi', 'airtime'], getAirtime, 2000),
};

/** End a device's Target Wake Time agreement; the band's state is read again after. */
export function useEndTwt(): UseMutationResult<unknown, Error, { device: string; mac: string; flow: number }> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ device, mac, flow }) => endTwt(device, mac, String(flow)),
    onSuccess: () => client.invalidateQueries({ queryKey: wifiQueries.twt().queryKey }),
  });
}
