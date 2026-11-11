import { z } from 'zod';
import { call } from '@/lib/ubus';

const radioStatus = z.object({
  up: z.boolean(),
  pending: z.boolean().optional(),
  disabled: z.boolean().optional(),
  // netifd gave up starting it (hostapd failed, e.g. a channel the country doesn't allow)
  retry_setup_failed: z.boolean().optional(),
  config: z
    .object({
      band: z.string().optional(),
      channel: z.union([z.string(), z.number()]).optional(),
      htmode: z.string().optional(),
      txpower: z.union([z.string(), z.number()]).optional(),
      country: z.string().optional(),
    })
    .loose()
    .optional(),
  // what the radio can do, e.g. HT20 … HE160, and its phy (luci-rpc adds iwinfo's info, Wi-Fi on or off)
  iwinfo: z.object({ phy: z.string().optional(), htmodes: z.array(z.string()).optional() }).loose().optional(),
  interfaces: z
    .array(
      z.object({
        section: z.string().optional(),
        ifname: z.string().optional(),
        config: z
          .object({
            ssid: z.string().optional(),
            mode: z.string().optional(),
            disabled: z.boolean().optional(),
            encryption: z.string().optional(),
            network: z.array(z.string()).optional(),
          })
          .loose()
          .optional(),
      }),
    )
    .optional(),
});
export type RadioStatus = z.output<typeof radioStatus>;

/**
 * netifd's view: radios with their configured and live interfaces. Read
 * through LuCI's luci-rpc, because OpenWrt 25.12's network.wireless object
 * rejects the session argument the web API adds to every call.
 */
export function getWirelessStatus(): Promise<Record<string, RadioStatus>> {
  return call('luci-rpc', 'getWirelessDevices', {}, z.record(z.string(), radioStatus));
}

const iwinfoInfo = z
  .object({
    phy: z.string().optional(),
    ssid: z.string().optional(),
    bssid: z.string().optional(),
    country: z.string().optional(),
    mode: z.string().optional(),
    channel: z.number().optional(),
    /** The centre of the whole channel, e.g. 42 for 36 at 80 MHz (36–48). */
    center_chan1: z.number().optional(),
    frequency: z.number().optional(),
    txpower: z.number().optional(),
    quality: z.number().optional(),
    quality_max: z.number().optional(),
    noise: z.number().optional(),
    htmode: z.string().optional(),
    hwmode: z.string().optional(),
    hwmodes_text: z.string().optional(),
  })
  .loose();
export type IwinfoInfo = z.output<typeof iwinfoInfo>;

export function getIwinfo(device: string): Promise<IwinfoInfo> {
  return call('iwinfo', 'info', { device }, iwinfoInfo);
}

const rate = z
  .object({
    rate: z.number().optional(),
    mcs: z.number().optional(),
    mhz: z.number().optional(),
    nss: z.number().optional(),
    ht: z.boolean().optional(),
    vht: z.boolean().optional(),
    he: z.boolean().optional(),
    eht: z.boolean().optional(),
    short_gi: z.boolean().optional(),
    packets: z.number().optional(),
    bytes: z.number().optional(),
  })
  .loose();

const station = z
  .object({
    mac: z.string(),
    signal: z.number().optional(),
    signal_avg: z.number().optional(),
    noise: z.number().optional(),
    inactive: z.number().optional(),
    connected_time: z.number().optional(),
    thr: z.number().optional(),
    authorized: z.boolean().optional(),
    rx: rate.optional(),
    tx: rate.optional(),
  })
  .loose();
export type Station = z.output<typeof station>;

export function getStations(device: string): Promise<Station[]> {
  return call('iwinfo', 'assoclist', { device }, z.object({ results: z.array(station) })).then((r) => r.results);
}

/** The Wi-Fi generation a rate was sent at: 7, 6, 5, 4, or 0 for the older ones (a/b/g). */
export function generationOf(r: z.output<typeof rate> | undefined): number | undefined {
  if (r?.rate === undefined) return undefined;
  return r.eht === true ? 7 : r.he === true ? 6 : r.vht === true ? 5 : r.ht === true ? 4 : 0;
}

/** "HE MCS 9, 2×2, 80 MHz" style summary of a station's rate. */
export function describeRate(r: z.output<typeof rate> | undefined): string | undefined {
  const g = generationOf(r);
  if (r === undefined || g === undefined) return undefined;
  const parts = [g === 0 ? 'legacy' : `Wi-Fi ${String(g)}`];
  if (r.mcs !== undefined) parts.push(`MCS ${String(r.mcs)}`);
  if (r.nss !== undefined) parts.push(`${String(r.nss)}×${String(r.nss)}`);
  if (r.mhz !== undefined) parts.push(`${String(r.mhz)} MHz`);
  return parts.join(' · ');
}

/** 2412 -> "2.4 GHz", 5180 -> "5 GHz", 5955 -> "6 GHz". */
export function bandOf(frequencyMhz: number | undefined): '2.4 GHz' | '5 GHz' | '6 GHz' | undefined {
  if (frequencyMhz === undefined) return undefined;
  if (frequencyMhz < 3000) return '2.4 GHz';
  if (frequencyMhz < 5925) return '5 GHz';
  return '6 GHz';
}

const freq = z
  .object({ channel: z.number(), mhz: z.number(), restricted: z.boolean().optional(), active: z.boolean().optional() })
  .loose();
export type Frequency = z.output<typeof freq>;

/** Channels the radio may use under its current country setting. */
export function getFrequencies(device: string): Promise<Frequency[]> {
  return call('iwinfo', 'freqlist', { device }, z.object({ results: z.array(freq) })).then((r) => r.results);
}

const txpower = z.object({ dbm: z.number(), mw: z.number(), active: z.boolean().optional() }).loose();

export function getTxPowers(device: string): Promise<{ dbm: number; mw: number }[]> {
  return call('iwinfo', 'txpowerlist', { device }, z.object({ results: z.array(txpower) })).then((r) => r.results);
}

export interface AccessPoint {
  radio: string;
  ifname: string;
  ssid: string | undefined;
  /** The networks (interfaces) it bridges into, e.g. lan or guest. */
  networks: string[];
  info: IwinfoInfo | undefined;
  stations: Station[];
}

/** Every access point that's up, with its live details and connected stations. */
export async function getAccessPoints(status?: Record<string, RadioStatus>): Promise<AccessPoint[]> {
  const wireless = status ?? (await getWirelessStatus());
  const aps = Object.entries(wireless).flatMap(([radio, r]) =>
    (r.interfaces ?? []).flatMap((i) =>
      i.ifname !== undefined && (i.config?.mode ?? 'ap') === 'ap'
        ? [{ radio, ifname: i.ifname, ssid: i.config?.ssid, networks: i.config?.network ?? [] }]
        : [],
    ),
  );
  return Promise.all(
    aps.map(async (ap) => {
      const [info, stations] = await Promise.all([
        getIwinfo(ap.ifname).catch(() => undefined),
        getStations(ap.ifname).catch(() => []),
      ]);
      return { ...ap, info, stations };
    }),
  );
}

/** The radio's channels (MHz) that need radar detection (DFS) under its country's rules; by interface or phy. */
export function getDfsFrequencies(device: string): Promise<number[]> {
  return call('milkflint.wifi', 'dfs', { device }, z.object({ mhz: z.array(z.number()) })).then((r) => r.mhz);
}

const radar = z.object({
  /** hostapd's radar events as the router kept them, oldest first (the last 200) */
  events: z.array(
    z.object({
      ms: z.number(),
      iface: z.string(),
      /** hostapd's event without "DFS-" (CAC-START, CAC-COMPLETED, RADAR-DETECTED, NEW-CHANNEL, NOP-FINISHED,
       * PRE-CAC-EXPIRED), or LEFT: hostapd left its radar-check state for `fields.state` */
      event: z.string(),
      /** the event's key=value fields as hostapd writes them (which ones depends on the event) */
      fields: z
        .object({
          freq: z.string().optional(),
          chan: z.string().optional(),
          sec_chan: z.string().optional(),
          width: z.string().optional(),
          seg0: z.string().optional(),
          cac_time: z.string().optional(),
          success: z.string().optional(),
          radar_detected: z.string().optional(),
          chan_width: z.string().optional(),
          cf1: z.string().optional(),
          state: z.string().optional(),
          // the DFS radar scan's own events (SCAN-START, SCAN-END, RADAR-DETECTED with scan=1)
          seconds: z.string().optional(),
          result: z.string().optional(),
          listened: z.string().optional(),
          scan: z.string().optional(),
          after: z.string().optional(),
          reason: z.string().optional(),
        })
        .loose(),
    }),
  ),
  /** the router keeps new radar events (the Logs page's radar log; absent from older routers) */
  logging: z.boolean().optional(),
  /** this radio's radar channels now */
  channels: z.array(
    z.object({
      mhz: z.number(),
      channel: z.number(),
      /** usable: needs a radar check first; available: checked; unavailable: radar heard, off limits */
      state: z.string(),
      /** seconds in that state */
      for_s: z.number().nullable(),
      /** how long its radar check takes */
      cac_ms: z.number().optional(),
    }),
  ),
});
export type Radar = z.output<typeof radar>;
export type RadarEvent = Radar['events'][number];

/** The radar log (every radio's, kept on the router's storage) and a radio's radar channels now. */
export function getRadar(device: string): Promise<Radar> {
  return call('milkflint.wifi', 'radar', { device }, radar);
}

const beamforming = z.object({
  /** an access point of this radio is up (otherwise vht and he are null) */
  running: z.boolean(),
  /** Wi-Fi 5 (802.11ac, 5 GHz only); null when the radio doesn't run it */
  vht: z
    .object({
      su_beamformer: z.boolean(),
      su_beamformee: z.boolean(),
      mu_beamformer: z.boolean(),
      mu_beamformee: z.boolean(),
      sounding_dimensions: z.number().nullable(),
      beamformee_antennas: z.number().nullable(),
    })
    .nullable(),
  /** Wi-Fi 6 (802.11ax); null when the radio doesn't run it */
  he: z.object({ su_beamformer: z.boolean(), su_beamformee: z.boolean(), mu_beamformer: z.boolean() }).nullable(),
});
export type Beamforming = z.output<typeof beamforming>;

const spatialReuse = z.object({
  /** an access point of this radio is up (otherwise control and offset are null) */
  running: z.boolean(),
  /** the driver's mode; null with a driver that has no such setting */
  mode: z.enum(['auto', 'fixed', 'off']).nullable(),
  /** he_spr_sr_control, as hostapd sends it in its beacons */
  control: z.number().nullable(),
  /** he_spr_non_srg_obss_pd_max_offset: from -82 dBm */
  offset: z.number().nullable(),
});
export type SpatialReuse = z.output<typeof spatialReuse>;

/** Spatial reuse on a radio now; by interface or phy. */
export function getSpatialReuse(device: string): Promise<SpatialReuse> {
  return call('milkflint.wifi', 'spatial_reuse', { device }, spatialReuse);
}

const twtStatus = z.object({
  /** an access point of this radio is up */
  running: z.boolean(),
  /** and offers TWT: Wi-Fi 6 and he_twt_responder not off */
  offered: z.boolean(),
  /** the driver has limits and agreements to show */
  supported: z.boolean(),
  policy: z
    .object({
      min_interval_ms: z.number(),
      max_interval_ms: z.number(),
      min_wake_dur: z.number(),
      max_flows: z.number(),
      max_sta_flows: z.number(),
      trigger: z.string(),
    })
    .nullable(),
  /** requests since the radio started */
  counters: z
    .object({
      accepted: z.number(),
      repeated: z.number(),
      replaced: z.number(),
      alternate: z.number(),
      dictate: z.number(),
      rejected: z.number(),
      teardown_rx: z.number(),
      teardown_tx: z.number(),
      lost: z.number(),
    })
    .nullable(),
  agreements: z.array(
    z.object({
      sta: z.string(),
      id: z.number(),
      interval_us: z.number(),
      wake_us: z.number(),
      trigger: z.number(),
      announced: z.number(),
      protection: z.number(),
      tsf: z.number(),
      age_s: z.number(),
    }),
  ),
  /** connected devices whose capabilities say they can ask */
  capable: z.array(z.string()),
  stations: z.number(),
});
export type TwtStatus = z.output<typeof twtStatus>;

/** Target Wake Time on a radio now; by interface or phy. */
export function getTwt(device: string): Promise<TwtStatus> {
  return call('milkflint.wifi', 'twt', { device }, twtStatus);
}

/** Ends a device's agreement and tells it. */
export function endTwt(device: string, mac: string, flow: string): Promise<unknown> {
  return call('milkflint.wifi', 'twt_end', { device, mac, flow }, z.object({ ok: z.literal(true) }));
}

/** The beamforming a radio's access points run with (hostapd's config for it); by interface or phy. */
export function getBeamforming(device: string): Promise<Beamforming> {
  return call('milkflint.wifi', 'beamforming', { device }, beamforming);
}

// What the policy itself decides is always there; what the service measures
// besides, for the page, has a default, so a service that says less still reads.
const airtimeDevice = z.object({
  mac: z.string(),
  /** from its lease or its reservation; null: not known */
  name: z.string().nullable().default(null),
  /** the access point's interface it's on, and that network's name */
  dev: z.string().default(''),
  ssid: z.string().nullable().default(null),
  /** dBm */
  signal: z.number().nullable().default(null),
  /** Mbit/s the router sends to it at (0: not known yet), and it sends at */
  rate: z.number(),
  rx_rate: z.number().default(0),
  /** share of the router's transmissions to it that got a frame through, 0..1 */
  delivery: z.number(),
  /** Mbit/s: rate x delivery, what the policy judges its link by */
  useful: z.number(),
  class: z.enum(['full', 'slow', 'weak', 'lost']),
  /** "slow link", "weak link", "not answering"; null with a full share */
  reason: z.string().nullable().default(null),
  /** airtime weight, 32..256: 256 is a full share, which every device has where the policy is off */
  weight: z.number(),
  /** its queue allowance in the radio is narrowed */
  narrowed: z.boolean().default(false),
  /** times each of its frames is sent before it's given up on; 0: the driver's own (also where the driver takes no number per device) */
  tries: z.number().default(0),
  /** the policy would pace it: its link is slow enough to be held back while a device with a good link is waiting */
  paced: z.boolean().default(false),
  /** the part of the time its ordinary traffic is sent for while others wait, in thousandths; 0: not paced (the policy is off, or the driver can't) */
  pace: z.number().default(0),
  /** share of the last second its traffic was held back, 0..1 */
  held: z.number().default(0),
  /** with the band's shares worked out as it goes (auto): its share of the air, in thousandths (0: none), and the factor its pacing is trimmed by so that what it takes, measured, is that share */
  aim: z.number().default(0),
  trim: z.number().default(1),
  /** share of the last second the router spent sending to it, and it spent sending, 0..1 */
  air_tx: z.number().default(0),
  air_rx: z.number().default(0),
  /** Mbit/s of traffic to it and from it in the last second */
  tx_mbit: z.number().default(0),
  rx_mbit: z.number().default(0),
  /** share of the last second it spent in power save, 0..1 */
  asleep: z.number().default(0),
  /** its link in detail: how the router sends to it and it to the router; null: not known */
  tx_phy: rate.nullable().default(null),
  rx_phy: rate.nullable().default(null),
  /** each antenna's signal, dBm (averaged); null where the radio doesn't say */
  chains: z.array(z.number()).nullable().default(null),
  /** seconds since it connected */
  connected: z.number().nullable().default(null),
});

const airtimeRadio = z.object({
  phy: z.string(),
  /** its wifi-device section ("radio1") */
  radio: z.string().nullable().default(null),
  band: z.enum(['2g', '5g', '6g']),
  channel: z.union([z.number(), z.string()]).nullable().default(null),
  /** the channel's width in MHz, and every 20 MHz channel it takes up, lowest first; null and none until known */
  width: z.number().nullable().default(null),
  channels: z.array(z.number()).default([]),
  /** the policy is applied on this band; otherwise the service only watches */
  on: z.boolean(),
  /** the radio's driver shares the air by weight, so the policy has something to set */
  weights: z.boolean().default(true),
  /** the radio's driver can hold a device back by time (pacing) */
  pacing: z.boolean().default(false),
  /** how the shares of the devices held back are set: a strength's name (auto), or null for the goals set by hand */
  auto: z.string().nullable().default(null),
  /** with auto applied: how many devices that aren't held back wanted the air in the last second (0: none, which counts as one); null otherwise */
  competing: z.number().nullable().default(null),
  /** share of the time the channel was busy, every network's use and noise counted, 0..1; null until known */
  busy: z.number().nullable().default(null),
  /** the part of `busy` that was other networks and noise, by the radio's own count, 0..1; null where it doesn't say */
  other: z.number().nullable().default(null),
  /** the noise the radio measures on its channel, dBm; null until known (it's read while this is asked for) */
  noise: z.number().nullable().default(null),
  devices: z.array(airtimeDevice).default([]),
  /**
   * up to a minute, a second each: the share of that second's air the devices of each class took, 0..1, and what
   * other networks and noise took (null for a second the channel wasn't read in: it's only read while this is asked for)
   */
  history: z
    .array(
      z.object({
        t: z.number(),
        full: z.number().default(0),
        slow: z.number().default(0),
        weak: z.number().default(0),
        lost: z.number().default(0),
        other: z.number().nullable().default(null),
      }),
    )
    .default([]),
});

const airtimeStatus = z.object({
  /** false: the service isn't running, or has only just been asked to measure */
  running: z.boolean(),
  /** the router's clock, epoch seconds */
  now: z.number().default(0),
  radios: z.array(airtimeRadio).default([]),
});
export type AirtimeStatus = z.output<typeof airtimeStatus>;
export type AirtimeRadio = AirtimeStatus['radios'][number];
export type AirtimeDevice = AirtimeRadio['devices'][number];

/**
 * What the airtime fairness service sees and does on each band now. Asking
 * also keeps it measuring on the bands whose policy is off.
 */
export function getAirtime(): Promise<AirtimeStatus> {
  return call('milkflint.airtime', 'status', {}, airtimeStatus);
}

const surveyEntry = z
  .object({
    mhz: z.number(),
    active_time: z.number().optional(),
    busy_time: z.number().optional(),
  })
  .loose();
export type SurveyEntry = z.output<typeof surveyEntry>;

/** Per channel: how long the radio listened, and how much of it the channel was busy (ms, cumulative). */
export function getSurvey(device: string): Promise<SurveyEntry[]> {
  return call('iwinfo', 'survey', { device }, z.object({ results: z.array(surveyEntry) })).then((r) => r.results);
}

export interface Country {
  code: string;
  name: string;
}

/** The countries the radio knows rules for ("00", the world rules, left out). Works with a phy name, so Wi-Fi needn't be on. */
export function getCountries(device: string): Promise<Country[]> {
  return call('iwinfo', 'countrylist', { device }, z.object({ results: z.array(z.object({ code: z.string(), country: z.string() }).loose()) })).then(
    (r) => r.results.filter((c) => c.code !== '00').map((c) => ({ code: c.code, name: c.country })),
  );
}

const regRule = z.object({
  /** MHz */
  start: z.number(),
  end: z.number(),
  max_bw: z.number(),
  /** dBm */
  eirp: z.number(),
  indoor_only: z.boolean(),
  dfs: z.boolean(),
  no_ir: z.boolean(),
  auto_bw: z.boolean(),
});
export type RegRule = z.output<typeof regRule>;

/** What a country's law lets Wi-Fi do (Linux's regulatory database on the router), set or not. */
export function getRegulatory(country: string): Promise<{ dfs_region: string; rules: RegRule[] }> {
  return call('milkflint.wifi', 'regulatory', { country }, z.object({ dfs_region: z.string(), rules: z.array(regRule) }));
}

/** The countries the router's regulatory database has rules for: the radio ignores any other. */
export function getRegulatedCountries(): Promise<string[]> {
  return call('milkflint.wifi', 'countries', {}, z.object({ countries: z.array(z.string()) })).then((r) => r.countries);
}
