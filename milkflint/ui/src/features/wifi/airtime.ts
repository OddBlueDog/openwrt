// Airtime fairness: a router service (features/airtime) looks at every Wi-Fi
// device's link once a second and, on the bands whose policy is on
// (milkflint.wifi.airtime_<band> '1'; anything else, unset too, is off), gives
// the ones with a poor link a smaller share of the air: a lower airtime weight,
// for weak or unreachable ones less of their traffic queued in the radio, and,
// where the driver can pace a device, the slowest are held back for part of
// the time while a device with a good link has traffic waiting.
// Off, the router's own airtime fairness applies (an equal share for every
// busy device) and the service only measures while the page is open. The
// service reads the option itself within a second: no radio restarts. What
// the card (airtime-card.tsx) shows of its reply is worked out here.

/**
 * What the policy makes of a device's link, by its useful rate (the rate the
 * router sends to it at, times the share of its frames that get through).
 */
export type AirtimeClass = 'full' | 'slow' | 'weak' | 'lost';

/** Best link first: the order of the bar, its legend and each second's column */
export const AIRTIME_CLASSES: readonly AirtimeClass[] = ['full', 'slow', 'weak', 'lost'];

/** mac80211's airtime weight for a full share, and the policy's smallest */
export const AIRTIME_FULL_WEIGHT = 256;
export const AIRTIME_SMALLEST_WEIGHT = 32;

/** milkflint.wifi's option for a band's policy */
export function airtimeOption(band: string): string {
  return `airtime_${band}`;
}

/** Whether the policy is on, as the service reads the option: only '1' is */
export function airtimeOf(value: string | undefined): boolean {
  return value === '1';
}

/** The option's value for the switch; undefined: unset, which is off */
export function airtimeValue(on: boolean): string | undefined {
  return on ? '1' : undefined;
}

/**
 * What the policy does on a band: applied; switched off, so only watched; or
 * switched on with a driver that doesn't share the air by weight, which
 * leaves it nothing to set.
 */
export type AirtimeState = 'on' | 'watching' | 'unsupported';

export function airtimeState(on: boolean, weights: boolean): AirtimeState {
  if (!on) return 'watching';
  return weights ? 'on' : 'unsupported';
}

export const AIRTIME_STATE_LABELS: Record<AirtimeState, string> = {
  on: 'Policy on',
  watching: 'Watching only',
  unsupported: 'Not possible on this radio',
};

export const AIRTIME_CLASS_LABELS: Record<AirtimeClass, string> = {
  full: 'Good link',
  slow: 'Slow link',
  weak: 'Weak link',
  lost: 'Not answering',
};

/**
 * A device's class in words. A slow link the policy paces is a very slow
 * one: below the band's very slow rate, where the slow ones are held back too.
 */
export function airtimeLabel(cls: AirtimeClass, paced = false): string {
  return cls === 'slow' && paced ? 'Very slow link' : AIRTIME_CLASS_LABELS[cls];
}

// ---- a band's settings: the rates that part the classes, and each paced
// class's airtime goal. milkflint.wifi's airtime_<band>_<key>; unset is the
// service's default, and so is anything that makes no sense (the service
// checks for itself, airtime-policy.uc's settings_of()).

/**
 * full, pace, weak: useful rates in Mbit/s, each where a class starts (a good
 * link from `full`, a slow one from `pace`, a very slow one from `weak`; a
 * weak one is below that). goal_*: percent of the time for the classes that
 * are held back: very slow, weak, not answering.
 */
export const AIRTIME_BAND_KEYS = ['full', 'pace', 'weak', 'goal_slow', 'goal_weak', 'goal_lost'] as const;
export type AirtimeBandKey = (typeof AIRTIME_BAND_KEYS)[number];

/**
 * How the shares of the devices that are held back are set: by hand (the
 * goals), or worked out as it goes at a strength (milkflint.wifi's
 * airtime_<band>_auto; unset, or anything but a strength's name, is by hand).
 * With auto, a held-back device's share is its weight over the sum of the
 * weights of the devices wanting the air at that moment, a weight being
 * (useful rate / good-link rate) to the power of the strength: gentle 0.5,
 * balanced 1, strict 1.5 (airtime-policy.uc's auto_pace()).
 */
export const AIRTIME_AUTOS = ['manual', 'gentle', 'balanced', 'strict'] as const;
export type AirtimeAuto = (typeof AIRTIME_AUTOS)[number];
export type AirtimeStrength = Exclude<AirtimeAuto, 'manual'>;
export const AIRTIME_STRENGTHS: Record<AirtimeStrength, number> = { gentle: 0.5, balanced: 1, strict: 1.5 };
export const AIRTIME_AUTO_LABELS: Record<AirtimeAuto, string> = {
  manual: 'Goals set by hand',
  gentle: 'Auto: gentle',
  balanced: 'Auto: balanced',
  strict: 'Auto: strict',
};

/** A strength by name as the service reads it; undefined for anything else (the goals) */
export function airtimeStrengthOf(value: string | null | undefined): AirtimeStrength | undefined {
  return value === 'gentle' || value === 'balanced' || value === 'strict' ? value : undefined;
}

/**
 * The settings that are only shown with the goals set by hand: with auto
 * they are neither shown, checked nor saved. The not-answering goal is one:
 * auto still uses it (a device that isn't answering gets it, and no share
 * goes under it), as it was last saved.
 */
const MANUAL_KEYS: readonly AirtimeBandKey[] = ['pace', 'goal_slow', 'goal_weak', 'goal_lost'];

/** As typed in the form, and how the shares are set */
export type AirtimeBands = Record<AirtimeBandKey, string> & { auto: AirtimeAuto };

const RATE_KEYS: readonly AirtimeBandKey[] = ['full', 'pace', 'weak'];
/** What the service takes: a rate from 1 to 10000 Mbit/s, a goal from 1 to 100% */
const RATE_MAX = 10000;

/** The service's defaults for a band (airtime-policy.uc's FULL, PACE, WEAK and GOALS) */
export function airtimeBandDefaults(band: string): AirtimeBands {
  const narrow = band === '2g';
  return { full: narrow ? '15' : '60', pace: narrow ? '8' : '30', weak: narrow ? '4' : '12', goal_slow: '17', goal_weak: '12', goal_lost: '5', auto: 'manual' };
}

/** milkflint.wifi's option for how a band's shares are set */
export function airtimeAutoOption(band: string): string {
  return `airtime_${band}_auto`;
}

/** milkflint.wifi's option for one of a band's settings */
export function airtimeBandOption(band: string, key: AirtimeBandKey): string {
  return `airtime_${band}_${key}`;
}

/** A band's settings as saved (`get`: milkflint.wifi's option by name), the default for each one unset */
export function airtimeBandsOf(get: (option: string) => string | undefined, band: string): AirtimeBands {
  const defaults = airtimeBandDefaults(band);
  const out = { ...defaults };
  for (const key of AIRTIME_BAND_KEYS) out[key] = get(airtimeBandOption(band, key)) ?? defaults[key];
  out.auto = airtimeStrengthOf(get(airtimeAutoOption(band))) ?? 'manual';
  return out;
}

/** A setting as a number; undefined unless it's digits, with a decimal part or not */
function bandNumber(value: string): number | undefined {
  return /^\d+(\.\d+)?$/.test(value.trim()) ? Number(value) : undefined;
}

/**
 * What's wrong with a band's settings, by field: a rate or goal out of its
 * range, or rates out of order (weak no higher than very slow, very slow no
 * higher than good; with auto, where there's no very slow rate to set, weak
 * no higher than good). Only the settings in use are checked. Empty: they
 * can be saved.
 */
export function airtimeBandsErrors(b: AirtimeBands): Partial<Record<AirtimeBandKey, string>> {
  const errors: Partial<Record<AirtimeBandKey, string>> = {};
  const n = Object.fromEntries(AIRTIME_BAND_KEYS.map((k) => [k, bandNumber(b[k])])) as Record<AirtimeBandKey, number | undefined>;
  const auto = b.auto !== 'manual';
  for (const key of AIRTIME_BAND_KEYS) {
    if (auto && MANUAL_KEYS.includes(key)) continue;
    const v = n[key];
    if (RATE_KEYS.includes(key)) {
      if (v === undefined || v < 1 || v > RATE_MAX) errors[key] = `Use a rate from 1 to ${String(RATE_MAX)} Mbit/s.`;
    } else if (v === undefined || v < 1 || v > 100) {
      errors[key] = 'Use 1 to 100%.';
    }
  }
  if (auto) {
    if (errors.weak === undefined && errors.full === undefined && n.weak !== undefined && n.full !== undefined && n.weak > n.full) {
      errors.weak = 'A very slow link can’t start above a good one.';
    }
    return errors;
  }
  if (errors.pace === undefined && errors.full === undefined && n.pace !== undefined && n.full !== undefined && n.pace > n.full) {
    errors.pace = 'A slow link can’t start above a good one.';
  }
  if (errors.weak === undefined && errors.pace === undefined && n.weak !== undefined && n.pace !== undefined && n.weak > n.pace) {
    errors.weak = 'A very slow link can’t start above a slow one.';
  }
  return errors;
}

/** Whether every number shown is the band's default (how the shares are set isn't one: the reset keeps it) */
export function airtimeBandsAreDefault(band: string, b: AirtimeBands): boolean {
  const defaults = airtimeBandDefaults(band);
  return AIRTIME_BAND_KEYS.every((k) => (b.auto !== 'manual' && MANUAL_KEYS.includes(k)) || bandNumber(b[k]) === Number(defaults[k]));
}

/** A band's settings at their defaults, keeping how its shares are set and, with auto, what isn't shown */
export function airtimeBandsReset(band: string, b: AirtimeBands): AirtimeBands {
  const defaults = airtimeBandDefaults(band);
  if (b.auto === 'manual') return defaults;
  return { ...defaults, auto: b.auto, pace: b.pace, goal_slow: b.goal_slow, goal_weak: b.goal_weak, goal_lost: b.goal_lost };
}

/**
 * What to save for a band's settings: each option's value, undefined (unset)
 * for one at its default, so that a default that changes later still
 * applies. Settings with something wrong in them aren't saved: {}.
 */
export function airtimeBandValues(band: string, b: AirtimeBands): Record<string, string | undefined> {
  if (Object.keys(airtimeBandsErrors(b)).length > 0) return {};
  const defaults = airtimeBandDefaults(band);
  // with auto, what isn't shown is left as it is
  const keys = AIRTIME_BAND_KEYS.filter((k) => b.auto === 'manual' || !MANUAL_KEYS.includes(k));
  return {
    ...Object.fromEntries(
      keys.map((k) => {
        const v = Number(b[k].trim());
        return [airtimeBandOption(band, k), v === Number(defaults[k]) ? undefined : String(v)];
      }),
    ),
    [airtimeAutoOption(band)]: b.auto === 'manual' ? undefined : b.auto,
  };
}

/**
 * With auto, the useful rate in Mbit/s below which a slow link is held back
 * too: where its share beside one good link would be under four fifths of an
 * even split, that is its weight under 2/3; to one place, and not below the
 * weak rate (airtime-policy.uc's auto_pace_rate()).
 */
export function airtimeAutoPaceRate(full: number, weak: number, strength: AirtimeStrength): number {
  const rate = Math.round(full * (2 / 3) ** (1 / AIRTIME_STRENGTHS[strength]) * 10) / 10;
  return Math.max(rate, weak);
}

/**
 * With auto, the share of the air a device at `rate` Mbit/s gets beside `others` devices with a good link that
 * want the air too, 0..1: its weight over the sum of all of theirs, and never under the not-answering goal
 * (`floor`, 0..1). The others count as one when there are none.
 */
export function airtimeAutoShare(rate: number, full: number, strength: AirtimeStrength, others: number, floor: number): number {
  const w = (Math.min(Math.max(rate, 0.1), full) / full) ** AIRTIME_STRENGTHS[strength];
  return Math.min(1, Math.max(floor, w / (w + Math.max(1, others))));
}

/** What the policy gives a device of each class. `pacing`: the radio's driver can hold a device back by time. */
export function airtimeClassHint(cls: AirtimeClass, pacing = false): string {
  switch (cls) {
    case 'full':
      return 'A full share of the air. Nothing is changed.';
    case 'slow':
      return `A reduced share of the air, smaller the slower the link.${pacing ? ' The slowest are also held back while a device with a good link is waiting.' : ''}`;
    case 'weak':
      return `A small share of the air, and only a frame or two of its traffic queued in the radio at a time.${pacing ? ' Held back while a device with a good link is waiting.' : ''}`;
    case 'lost':
      return `Frames to it keep failing while it’s awake: the smallest share, one frame at a time, until one is answered.${pacing ? ' Held back while a device with a good link is waiting.' : ''}`;
  }
}

/**
 * Who a held-back device waits for, with auto: the devices that aren't held
 * back and want the air (`competing`; 0 or unknown counts as one).
 */
function waitingWords(competing: number | undefined): string {
  return competing === undefined || competing <= 1 ? 'a device with a better link is waiting' : `${String(competing)} devices with better links are waiting`;
}

/**
 * With auto, how the driver's pacing differs from a device's share, for the
 * line's tooltip: the driver counts airtime by an estimate that leaves
 * repeats out, so the service trims the pacing until what the device takes,
 * measured, is its share. undefined while they're within a percent.
 */
export function airtimeTrimWords(pace: number, aim: number): string | undefined {
  if (aim <= 0 || pace <= 0 || Math.abs(pace - aim) < 10) return undefined;
  return `Paced at ${airtimePacePercent(pace)} of the time by the driver’s estimate, which leaves out frames sent again: measured, that comes to its share.`;
}

/** A pacing share (thousandths of the time) as a whole percent: 238 is "24%" */
export function airtimePacePercent(pace: number): string {
  return `${String(Math.max(1, Math.round(pace / 10)))}%`;
}

/**
 * What is done to a device of a class besides its share, for its row in the
 * list. `applied` false: the band's policy is off, so what it would do.
 * `tries`: how many times each of its frames is sent before it's given up
 * on, where the driver takes a number per device (0: the driver's own).
 * `pace`: the part of the time, in thousandths, its ordinary traffic is sent
 * for while a device with a good link is waiting (0: not paced). `wouldPace`:
 * with the policy on it would be paced. undefined: nothing to add.
 */
export function airtimeDoing(
  cls: AirtimeClass,
  applied: boolean,
  {
    tries = 0,
    pace = 0,
    wouldPace = false,
    aim = 0,
    competing,
  }: {
    tries?: number;
    pace?: number;
    wouldPace?: boolean;
    /** with auto: its share of the air, in thousandths (0: not auto), and how many devices that aren't held back want the air */
    aim?: number;
    competing?: number | undefined;
  } = {},
): string | undefined {
  const sends = applied && tries > 0 ? ` Each frame is sent ${tries === 1 ? 'once' : `at most ${String(tries)} times`}.` : '';
  const held =
    applied && pace > 0
      ? aim > 0
        ? `Held to about ${airtimePacePercent(aim)} of the air while ${waitingWords(competing)}.`
        : `Held to ${airtimePacePercent(pace)} of the time while a device with a good link is waiting.`
      : '';
  const would = wouldPace ? ', and held back while a device with a good link is waiting.' : '.';
  switch (cls) {
    case 'full':
      return undefined;
    case 'slow':
      if (applied) return held === '' ? undefined : held;
      return `With the policy on: a reduced share${would}`;
    case 'weak':
      return applied
        ? `Kept to a frame or two in the radio at a time.${held === '' ? '' : ` ${held}`}${sends}`
        : `With the policy on: a small share, kept to a frame or two in the radio at a time${would}`;
    case 'lost':
      return applied
        ? `Kept to one frame in the radio at a time until it answers.${held === '' ? '' : ` ${held}`}${sends}`
        : `With the policy on: the smallest share, one frame in the radio at a time until it answers${would}`;
  }
}

/**
 * How much of the last second a paced device's traffic was held back, in
 * words; undefined for less than half a percent of it.
 */
export function airtimeHeldWords(held: number): string | undefined {
  if (!Number.isFinite(held) || held < 0.005) return undefined;
  return `Held back for ${String(Math.round(Math.min(1, held) * 100))}% of the last second.`;
}

/**
 * A device's signal in words, as the router hears it: "-67 dBm", and where
 * the radio's noise on the channel is known how far above it that is:
 * "-67 dBm, 25 dB above the noise". undefined without a signal.
 */
export function airtimeSignalWords(signal: number | null, noise: number | null): string | undefined {
  if (signal === null || !Number.isFinite(signal)) return undefined;
  const dbm = `${String(Math.round(signal))} dBm`;
  // a noise figure of 0 or more is a radio that has none
  if (noise === null || !Number.isFinite(noise) || noise >= 0 || signal <= noise) return dbm;
  return `${dbm}, ${String(Math.round(signal - noise))} dB above the noise`;
}

/**
 * How strong a signal is, for its icon: 4 at -55 dBm or better, a step down
 * for each 10 dB less, 0 below -85 dBm.
 */
export function airtimeSignalLevel(signal: number): 0 | 1 | 2 | 3 | 4 {
  return signal >= -55 ? 4 : signal >= -65 ? 3 : signal >= -75 ? 2 : signal >= -85 ? 1 : 0;
}

/** Each of the router's antennas' signal from a device, for the signal's tooltip; undefined with fewer than two */
export function airtimeChainsWords(chains: readonly number[] | null): string | undefined {
  if (chains === null || chains.length < 2) return undefined;
  return `By antenna: ${chains.map((c) => String(Math.round(c))).join(', ')} dBm`;
}

/** A weight as the part of a full share it is, 0..1, for the meter */
export function airtimeWeightPart(weight: number): number {
  return Math.max(0, Math.min(1, weight / AIRTIME_FULL_WEIGHT));
}

/**
 * A weight in words. Only a weight of 256 is a full share and only the
 * policy's lowest the smallest; between them, the nearest of three quarters,
 * a half and a quarter.
 */
export function airtimeShareWords(weight: number): string {
  if (weight >= AIRTIME_FULL_WEIGHT) return 'a full share';
  if (weight <= AIRTIME_SMALLEST_WEIGHT) return 'the smallest share';
  const part = weight / AIRTIME_FULL_WEIGHT;
  if (part >= 0.625) return 'about three quarters of a share';
  if (part >= 0.375) return 'about half a share';
  return 'about a quarter of a share';
}

/** What the bar and the list need of a device (the router's reply has more) */
export interface AirtimeUse {
  mac: string;
  /** the access point's interface it's on */
  dev?: string | undefined;
  name: string | null;
  class: AirtimeClass;
  /** share of the last second the router spent sending to it, 0..1 */
  air_tx: number;
  /** and the device spent sending */
  air_rx: number;
}

/**
 * What tells a radio's devices apart: the address, with the interface where
 * the router gives it, as a device that moves between two of a radio's
 * networks is on both for a moment.
 */
export function airtimeKey(d: Pick<AirtimeUse, 'mac' | 'dev'>): string {
  return d.dev === undefined || d.dev === '' ? d.mac : `${d.dev} ${d.mac}`;
}

/** The share of the last second's air a device took, both ways, 0..1 */
export function airtimeShare(d: Pick<AirtimeUse, 'air_tx' | 'air_rx'>): number {
  const share = d.air_tx + d.air_rx;
  return Number.isFinite(share) ? Math.max(0, Math.min(1, share)) : 0;
}

/** The air each class's devices took between them */
export function airtimeByClass(devices: readonly AirtimeUse[]): Record<AirtimeClass, number> {
  const out: Record<AirtimeClass, number> = { full: 0, slow: 0, weak: 0, lost: 0 };
  for (const d of devices) out[d.class] += airtimeShare(d);
  return out;
}

/** Named devices by name, then the unnamed by address */
function byName(a: AirtimeUse, b: AirtimeUse): number {
  if ((a.name === null) !== (b.name === null)) return a.name === null ? 1 : -1;
  const names = (a.name ?? '').localeCompare(b.name ?? '', 'en', { sensitivity: 'base', numeric: true });
  return names !== 0 ? names : a.mac.localeCompare(b.mac);
}

/**
 * The device list's order: most airtime first, then by name. Airtime counts
 * as the whole percent the list shows, so devices showing the same figure
 * (the idle ones, mostly) keep their places from one second to the next.
 */
export function airtimeSorted<D extends AirtimeUse>(devices: readonly D[]): D[] {
  const shown = (d: D): number => Math.round(airtimeShare(d) * 100);
  return [...devices].sort((a, b) => (shown(a) !== shown(b) ? shown(b) - shown(a) : byName(a, b)));
}

export type AirtimeSegment<D extends AirtimeUse> = {
  /** the device's key (airtimeKey), 'other' or 'free' */
  key: string;
  label: string;
  /** share of the last second's air, 0..1, as measured */
  share: number;
  /** its part of the bar, 0..1: a bar's segments add up to 1 */
  width: number;
} & ({ kind: 'device'; device: D } | { kind: 'other' | 'free' });

/**
 * The bar of a radio's air in the last second: a segment per device, then
 * what other networks and noise took (`rest`, the router's own figure for
 * it; without one, the channel's busy share less the devices' own; left out
 * while `busy` isn't known), then what was free.
 * Devices are in class order and by name within a class, not by airtime, so
 * a segment stays where it is while its width changes. If the devices'
 * shares add up to more than the whole second, the bar is theirs alone, to
 * scale.
 */
export function airtimeSegments<D extends AirtimeUse>(devices: readonly D[], busy: number | null, rest: number | null = null): AirtimeSegment<D>[] {
  const rank = (d: D): number => AIRTIME_CLASSES.indexOf(d.class);
  const ordered = [...devices].sort((a, b) => (a.class !== b.class ? rank(a) - rank(b) : byName(a, b)));
  const ours = ordered.reduce((n, d) => n + airtimeShare(d), 0);
  const left = busy === null ? 0 : Math.max(0, Math.min(1, busy) - ours);
  const other = busy !== null && rest !== null ? Math.max(0, Math.min(1, rest)) : left;
  const used = ours + other;
  const scale = used > 1 ? 1 / used : 1;
  const free = Math.max(0, 1 - used);
  const segments: AirtimeSegment<D>[] = ordered.map((device) => {
    const share = airtimeShare(device);
    return { kind: 'device', key: airtimeKey(device), label: device.name ?? device.mac, share, width: share * scale, device };
  });
  if (busy !== null) segments.push({ kind: 'other', key: 'other', label: 'Other networks and noise', share: other, width: other * scale });
  segments.push({ kind: 'free', key: 'free', label: busy === null ? 'Not used by this band’s devices' : 'Free', share: free, width: free });
  return segments;
}

/**
 * The channels a band's radio is using, in the words of the page's live
 * figures (live.tsx): "Channel 36", or for a wider channel every 20 MHz
 * channel it takes up as a range, the one it's on and the width:
 * "Channels 36–64 (primary 36) · 160 MHz". `channels`: lowest first; while
 * they aren't known, just the one it's on. undefined with nothing known.
 */
export function airtimeChannelsLabel(channel: number | string | null, channels: readonly number[], width: number | null): string | undefined {
  const first = channels[0];
  const last = channels.at(-1);
  if (first !== undefined && last !== undefined && channels.length > 1) {
    const primary = channel === null ? '' : ` (primary ${String(channel)})`;
    return `Channels ${String(first)}–${String(last)}${primary}${width === null ? '' : ` · ${String(width)} MHz`}`;
  }
  const only = first ?? channel;
  return only === null ? undefined : `Channel ${String(only)}`;
}

/**
 * One second of a radio's history: the share of its air each class's devices
 * took, and what other networks and noise took (null or missing: the channel
 * wasn't read that second, which the router only does while the page is open).
 */
export type AirtimeSecond = { t: number; other?: number | null } & Record<AirtimeClass, number>;

/** The air a second's devices took between them */
export function airtimeSecondTotal(s: AirtimeSecond): number {
  return AIRTIME_CLASSES.reduce((n, cls) => n + Math.max(0, s[cls]), 0);
}

/**
 * The strip's columns, oldest first: the last `slots` seconds, with empty
 * columns in front while there are fewer, so the newest is always the last.
 */
export function airtimeColumns<S>(history: readonly S[], slots: number): (S | undefined)[] {
  const recent = slots > 0 ? history.slice(-slots) : [];
  return [...Array.from({ length: slots - recent.length }, () => undefined), ...recent];
}

/**
 * The marks at the strip's sides, top down. Its full height is always all of
 * the air, so a bar's height means the same on every band and at every moment.
 */
export const AIRTIME_STRIP_MARKS = [1, 0.75, 0.5, 0.25] as const;

/** How long ago a column's second was, for its breakdown: `ago` whole seconds, 0 the newest */
export function airtimeAgo(ago: number): string {
  return ago <= 0 ? 'The last second' : `${String(ago)} s ago`;
}

/** A line of a second's breakdown: a class's devices, other networks and noise, or what was free */
export interface AirtimeSecondPart {
  key: AirtimeClass | 'other' | 'free';
  label: string;
  /** share of that second's air, 0..1; null: not known (the channel wasn't read that second) */
  share: number | null;
}

/**
 * A second's air in full, for its breakdown, in the order of the bar above
 * it: every class's devices, best link first, then other networks and noise,
 * then what was free. The last two aren't known for a second the channel
 * wasn't read in.
 */
export function airtimeSecondParts(s: AirtimeSecond): AirtimeSecondPart[] {
  const classes = AIRTIME_CLASSES.map((cls): AirtimeSecondPart => ({ key: cls, label: AIRTIME_CLASS_LABELS[cls], share: Math.max(0, s[cls]) }));
  const ours = classes.reduce((n, part) => n + (part.share ?? 0), 0);
  const other = s.other === undefined || s.other === null ? null : Math.max(0, Math.min(1, s.other));
  return [
    ...classes,
    { key: 'other', label: 'Other networks and noise', share: other },
    { key: 'free', label: 'Free', share: other === null ? null : Math.max(0, 1 - ours - other) },
  ];
}
