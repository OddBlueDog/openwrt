import { z } from 'zod';
import { getIwinfo, getWirelessStatus } from '@/lib/api/wireless';
import { call } from '@/lib/ubus';
import { widthOf } from '../wifi/channels';
import type { Radio } from './model';
import { bandOrder, channelMhz } from './spectrum';

const suites = z.object({ ciphers: z.array(z.string()), akm: z.array(z.string()) });

const network = z.object({
  bssid: z.string(),
  /** null: a hidden network (it doesn't say its name) */
  ssid: z.string().nullable(),
  /** The primary channel's centre. */
  mhz: z.number(),
  band: z.enum(['2g', '5g', '6g']),
  channel: z.number(),
  /** The whole channel: its width and centre (MHz). */
  width: z.number(),
  center: z.number(),
  /** dBm */
  signal: z.number().nullable(),
  seen_ms: z.number().optional(),
  /** The newest standard it offers: be (Wi-Fi 7), ax, ac, n or legacy. */
  standard: z.string(),
  security: z.object({
    /** The Privacy bit: with no WPA or RSN element, WEP. */
    privacy: z.boolean(),
    wpa: suites.nullish(),
    rsn: suites.extend({ mfp: z.string().nullable() }).nullish(),
  }),
  /** From its BSS Load element, when it sends one. */
  stations: z.number().nullish(),
  utilization: z.number().nullish(),
  country: z.string().nullish(),
  wps: z.object({ name: z.string().optional(), manufacturer: z.string().optional(), model: z.string().optional() }).nullish(),
  /** The radio (phy) that heard it. */
  radio: z.string(),
});
export type ScannedNetwork = z.output<typeof network>;

const radio = z.object({
  phy: z.string(),
  ifname: z.string().nullable(),
  band: z.string().nullable(),
  /** This router's channel on it while it scanned. */
  mhz: z.number().nullable(),
  width: z.number().nullable(),
  center: z.number().nullable(),
  error: z.string().nullable(),
  duration_ms: z.number().optional(),
});
export type ScannedRadio = z.output<typeof radio>;

const scanState = z.object({
  state: z.enum(['none', 'running', 'done', 'failed']),
  /** Epoch seconds, by the router's clock (`now`). */
  started: z.number().optional(),
  finished: z.number().optional(),
  now: z.number(),
  phys: z.array(z.string()).optional(),
  radios: z.array(radio).optional(),
  networks: z.array(network).optional(),
});
export type ScanState = z.output<typeof scanState>;

/** Scan these radios (phys) for nearby networks, in the background on the router. */
export async function startScan(phys: readonly string[]): Promise<void> {
  const res = await call(
    'milkflint.wifiscan',
    'start',
    { phys },
    z.object({ started: z.boolean().optional(), error: z.string().optional() }),
  );
  if (res.error !== undefined)
    throw new Error(res.error === 'busy' ? 'A scan is already running.' : `The router refused the scan (${res.error}).`);
}

/** The last scan: running, or what it found. */
export function getScan(): Promise<ScanState> {
  return call('milkflint.wifiscan', 'results', {}, scanState);
}

/** This router's radios as they run now: their channel, width and whether they can scan. */
export async function loadRadios(): Promise<Radio[]> {
  const status = await getWirelessStatus();
  const radios = await Promise.all(
    Object.entries(status).map(async ([radio, r]): Promise<Radio | undefined> => {
      const band = r.config?.band;
      if (band !== '2g' && band !== '5g' && band !== '6g') return undefined;
      const aps = (r.interfaces ?? []).filter((i) => (i.config?.mode ?? 'ap') === 'ap' && i.ifname !== undefined);
      // radios that are off with no access point aren't Wi-Fi networks here (as on Networks & radios)
      if (r.disabled === true && aps.length === 0) return undefined;
      const ifname = aps[0]?.ifname;
      const info = r.disabled === true || ifname === undefined ? undefined : await getIwinfo(ifname).catch(() => undefined);
      const width = widthOf(info?.htmode ?? r.config?.htmode);
      const center = info?.center_chan1 !== undefined ? channelMhz(band, info.center_chan1) : info?.frequency;
      return {
        radio,
        band,
        phy: r.iwinfo?.phy,
        online: info?.frequency !== undefined,
        auto: String(r.config?.channel ?? 'auto') === 'auto',
        channel: info?.channel,
        span: center === undefined ? undefined : [center - width / 2, center + width / 2],
        width,
        country: r.config?.country,
      };
    }),
  );
  return radios.filter((r): r is Radio => r !== undefined).sort((a, b) => bandOrder.indexOf(a.band) - bandOrder.indexOf(b.band));
}
