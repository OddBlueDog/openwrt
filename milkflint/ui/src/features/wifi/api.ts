// The Wi-Fi pages' reads that aren't the settings (load.ts has those): what
// each band's radio reports now, for the radar, beamforming and Target Wake
// Time cards and each band's live readings.
import { getDevices, getLeases } from '@/lib/api/network';
import {
  type Beamforming,
  getAccessPoints,
  getBeamforming,
  getRadar,
  getSurvey,
  getTwt,
  getWirelessStatus,
  type SurveyEntry,
  type Radar,
  type TwtStatus,
} from '@/lib/api/wireless';

/** A 5 GHz band and what its radar detection has heard and done. */
export interface RadarBand {
  radio: string;
  radar: Radar | undefined;
}

export async function loadRadarBands(): Promise<RadarBand[]> {
  const status = await getWirelessStatus();
  const bands = Object.entries(status).filter(([, r]) => r.config?.band === '5g');
  return Promise.all(
    bands.map(async ([radio, r]): Promise<RadarBand> => {
      const phy = r.iwinfo?.phy;
      return { radio, radar: phy === undefined ? undefined : await getRadar(phy).catch(() => undefined) };
    }),
  );
}

/** A band that's on and the beamforming its radio runs with. */
export interface BeamformingBand {
  radio: string;
  band: string;
  beamforming: Beamforming | undefined;
}

export async function loadBeamformingBands(): Promise<BeamformingBand[]> {
  const status = await getWirelessStatus();
  return Promise.all(
    // a radio that's turned off has nothing to report
    Object.entries(status)
      .filter(([, r]) => r.disabled !== true)
      .map(async ([radio, r]): Promise<BeamformingBand> => {
        const phy = r.iwinfo?.phy;
        return {
          radio,
          band: r.config?.band ?? '',
          beamforming: phy === undefined ? undefined : await getBeamforming(phy).catch(() => undefined),
        };
      }),
  );
}

/** A band that's on, its phy, and its Target Wake Time state. */
export interface TwtBand {
  radio: string;
  band: string;
  device: string | undefined;
  twt: TwtStatus | undefined;
}

export interface TwtLoaded {
  bands: TwtBand[];
  names: Map<string, string>;
}

export async function loadTwt(): Promise<TwtLoaded> {
  const [status, leases] = await Promise.all([getWirelessStatus(), getLeases().catch(() => [])]);
  const bands = await Promise.all(
    // a radio that's turned off has nothing to report
    Object.entries(status)
      .filter(([, r]) => r.disabled !== true)
      .map(async ([radio, r]): Promise<TwtBand> => {
        const device = r.iwinfo?.phy;
        return {
          radio,
          band: r.config?.band ?? '',
          device,
          twt: device === undefined ? undefined : await getTwt(device).catch(() => undefined),
        };
      }),
  );
  return {
    bands,
    names: new Map(leases.flatMap((l) => (l.hostname === undefined ? [] : [[l.macaddr.toLowerCase(), l.hostname]]))),
  };
}

/** How often each band's live readings are read. */
export const LIVE_POLL_MS = 3000;

/** What the router reports each sample: everything a band's live readings come from. */
export interface LiveSample {
  status: Awaited<ReturnType<typeof getWirelessStatus>>;
  aps: Awaited<ReturnType<typeof getAccessPoints>>;
  devices: Awaited<ReturnType<typeof getDevices>>;
  surveys: Map<string, SurveyEntry[]>;
  names: Map<string, string>;
}

/** One sample of every band, in one go (the calls go out together). */
export async function loadLiveSample(): Promise<LiveSample> {
  const status = await getWirelessStatus();
  const [aps, devices, leases] = await Promise.all([getAccessPoints(status), getDevices(), getLeases().catch(() => [])]);
  const surveys = new Map(
    await Promise.all(aps.map(async (ap) => [ap.ifname, await getSurvey(ap.ifname).catch((): SurveyEntry[] => [])] as const)),
  );
  const names = new Map(
    leases.flatMap((l) => (l.hostname === undefined ? [] : [[l.macaddr.toLowerCase(), l.hostname] as const])),
  );
  return { status, aps, devices, surveys, names };
}
