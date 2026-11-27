// The live state of each band, at the top of its card on the Wi-Fi page: on
// or off, what it runs on, devices, throughput now, airtime and signal.
import { useState } from 'react';
import { useLive } from '@/lib/query/use-live';
import { stationSnr } from '@/lib/api/wireless';
import type { LiveSample } from './api';
import { onGuestNetwork } from '../wifi-guest/guest';
import { blockAround, blockOf, widthOf } from './channels';
import { wifiQueries } from './queries';

export { LIVE_POLL_MS } from './api';
/** Two minutes of samples for each band's sparkline. */
export const LIVE_HISTORY = 40;
/** A network whose interface hostapd hasn't brought up after this long didn't start. */
const FAILED_AFTER_MS = 30_000;

export interface LiveBand {
  radio: string;
  band: string;
  /** checking: choosing a channel, or listening for radar before using it */
  state: 'online' | 'off' | 'starting' | 'checking' | 'failed';
  ssid: string | undefined;
  /** The band's own network's section in the wireless config, for its password. */
  section: string | undefined;
  channel: number | undefined;
  /** The 20 MHz channels it takes up at its width (the primary is `channel`). */
  block: number[] | undefined;
  htmode: string | undefined;
  /** Every device on the band, guests too. */
  clients: number;
  /** Devices on its guest network; undefined when it has none. */
  guests: number | undefined;
  weakest: { name: string; signal: number; snr: number | undefined } | undefined;
  /** bits/s: what devices download (the access point's tx) and upload (its rx). */
  down: number | undefined;
  up: number | undefined;
  /** Bytes since the access points started. */
  sent: number | undefined;
  received: number | undefined;
  /** Share of the time the channel was busy, since the previous sample. */
  airtime: number | undefined;
  noise: number | undefined;
  txpower: number | undefined;
  history: (number | undefined)[];
}

interface Previous {
  at: number;
  /** The access points counted: when that changes, so do the totals. */
  ifnames: string;
  rx: number;
  tx: number;
  busy: number | undefined;
  active: number | undefined;
}

/** "HE80" -> "Wi-Fi 6 · 80 MHz". */
export function modeLabel(htmode: string | undefined): string | undefined {
  const m = /^(EHT|HE|VHT|HT|NOHT)(\d*)/.exec(htmode ?? '');
  if (m === null) return undefined;
  const gen = { EHT: 'Wi-Fi 7', HE: 'Wi-Fi 6', VHT: 'Wi-Fi 5', HT: 'Wi-Fi 4', NOHT: 'Legacy' }[
    m[1] as 'EHT' | 'HE' | 'VHT' | 'HT' | 'NOHT'
  ];
  return m[2] === undefined || m[2] === '' ? gen : `${gen} · ${m[2]} MHz`;
}

/** "Channel 36", or "Channels 36–48 (primary 36)" when it's wider than 20 MHz. */
export function channelLabel(b: Pick<LiveBand, 'channel' | 'block'>): string | undefined {
  if (b.channel === undefined) return undefined;
  const first = b.block?.[0];
  const last = b.block?.at(-1);
  if (first === undefined || last === undefined || first === last) return `Channel ${String(b.channel)}`;
  return `Channels ${String(first)}–${String(last)} (primary ${String(b.channel)})`;
}

/** What's kept from one sample to the next: the counters rates are worked out from, the sparklines, and since when a network's been missing. */
export interface LiveState {
  /** when the last sample counted came, epoch ms */
  at: number | undefined;
  bands: LiveBand[] | undefined;
  previous: Map<string, Previous>;
  history: Map<string, (number | undefined)[]>;
  missingSince: Map<string, number>;
}

export const liveStart = (): LiveState => ({
  at: undefined,
  bands: undefined,
  previous: new Map(),
  history: new Map(),
  missingSince: new Map(),
});

/** The bands from a new sample taken at `now` (epoch ms): rates and airtime since the one before, each sample counted once. */
export function liveStep(state: LiveState, sample: LiveSample, now: number): LiveState {
  const previous = new Map(state.previous);
  const history = new Map(state.history);
  const missingSince = new Map(state.missingSince);
  const { status, aps, devices, surveys, names } = sample;

  // as the settings below: radios that are off and have no access point aren't networks
  const used = Object.entries(status).filter(
    ([, r]) => r.disabled !== true || (r.interfaces ?? []).some((i) => (i.config?.mode ?? 'ap') === 'ap'),
  );
  const bands = used.map(([radio, r]): LiveBand => {
    // the band's own network for what it runs on; traffic and devices of its guest network too
    const mine = aps.filter((a) => a.radio === radio);
    const ap = mine.find((a) => !onGuestNetwork(a.networks)) ?? mine[0];
    const guestAps = mine.filter((a) => onGuestNetwork(a.networks));
    const info = ap?.info;
    const counters = mine.flatMap((a) => devices[a.ifname]?.statistics ?? []);
    const stats =
      counters.length === 0
        ? undefined
        : { rx_bytes: counters.reduce((n, c) => n + c.rx_bytes, 0), tx_bytes: counters.reduce((n, c) => n + c.tx_bytes, 0) };
    const ifnames = mine.map((a) => a.ifname).join(' ');
    const survey = surveys.get(ap?.ifname ?? '')?.find((s) => s.mhz === info?.frequency);

    // rates and airtime since the previous sample of this band's access points
    const last = previous.get(radio);
    const prev = last?.ifnames === ifnames ? last : undefined;
    const seconds = prev === undefined ? 0 : (now - prev.at) / 1000;
    const perSecond = (before: number | undefined, after: number | undefined): number | undefined =>
      before === undefined || after === undefined || seconds <= 0 || after < before
        ? undefined
        : ((after - before) * 8) / seconds;
    const down = perSecond(prev?.tx, stats?.tx_bytes);
    const up = perSecond(prev?.rx, stats?.rx_bytes);
    const activeDelta = (survey?.active_time ?? 0) - (prev?.active ?? 0);
    const busyDelta = (survey?.busy_time ?? 0) - (prev?.busy ?? 0);
    const airtime =
      prev?.active !== undefined && activeDelta > 0 && busyDelta >= 0 ? Math.min(1, busyDelta / activeDelta) : undefined;
    if (stats !== undefined) {
      previous.set(radio, {
        at: now,
        ifnames,
        rx: stats.rx_bytes,
        tx: stats.tx_bytes,
        busy: survey?.busy_time,
        active: survey?.active_time,
      });
    }
    const series = [
      ...(history.get(radio) ?? []),
      down === undefined && up === undefined ? undefined : (down ?? 0) + (up ?? 0),
    ].slice(-LIVE_HISTORY);
    history.set(radio, series);

    const signals = mine
      .flatMap((a) => a.stations)
      .flatMap((s) => {
        const signal = s.signal_avg ?? s.signal;
        return signal === undefined
          ? []
          : [{ name: names.get(s.mac.toLowerCase()) ?? s.mac, signal, snr: stationSnr(s, info?.noise) }];
      });
    const weakest = signals.reduce<{ name: string; signal: number; snr: number | undefined } | undefined>(
      (w, s) => (w === undefined || s.signal < w.signal ? s : w),
      undefined,
    );
    // netifd lists only the networks that are on; a radio with none is up but has nothing to start
    const networkOn = (r.interfaces ?? []).some((i) => (i.config?.mode ?? 'ap') === 'ap' && i.config?.disabled !== true);
    // the interface, once hostapd has it: carrier while it broadcasts, none while it picks a channel or
    // listens for radar; never there when hostapd couldn't start it (a channel the country doesn't allow)
    const dev = ap === undefined ? undefined : devices[ap.ifname];
    if (r.disabled === true || !networkOn || dev?.up === true) missingSince.delete(radio);
    else if (!missingSince.has(radio)) missingSince.set(radio, now);
    const missing = now - (missingSince.get(radio) ?? now);
    const htmode = info?.htmode ?? r.config?.htmode;
    const band = r.config?.band ?? '';
    const width = widthOf(htmode);
    const block =
      info?.channel === undefined
        ? undefined
        : info.center_chan1 === undefined
          ? blockOf(band, info.channel, width)
          : blockAround(info.center_chan1, width);

    return {
      radio,
      band,
      state:
        r.disabled === true || !networkOn
          ? 'off'
          : dev?.up === true && dev.carrier === true
            ? 'online'
            : dev?.up === true
              ? 'checking'
              : r.retry_setup_failed === true || missing > FAILED_AFTER_MS
                ? 'failed'
                : 'starting',
      ssid: ap?.ssid ?? info?.ssid,
      section: (r.interfaces ?? []).find((i) => ap !== undefined && i.ifname === ap.ifname)?.section,
      channel: info?.channel,
      block,
      htmode,
      clients: mine.reduce((n, a) => n + a.stations.length, 0),
      guests: guestAps.length === 0 ? undefined : guestAps.reduce((n, a) => n + a.stations.length, 0),
      weakest,
      down,
      up,
      sent: stats?.tx_bytes,
      received: stats?.rx_bytes,
      airtime,
      // 0 or above: the driver doesn't know
      noise: info?.noise !== undefined && info.noise < 0 ? info.noise : undefined,
      txpower: info?.txpower,
      history: series,
    };
  });
  return { at: now, bands, previous, history, missingSince };
}

/** Each band's live readings, every LIVE_POLL_MS. */
export function useWifiLive(): LiveBand[] | undefined {
  const { data, at } = useLive(wifiQueries.live());
  const [state, setState] = useState(liveStart);
  // each answer once, by when it came: a re-render never counts a sample twice
  if (data !== undefined && at !== undefined && at !== state.at) setState(liveStep(state, data, at));
  return state.bands;
}
