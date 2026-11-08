// Target Wake Time (802.11ax): a device and the router agree the times it wakes,
// and it sleeps in between. The device asks and chooses; the settings say whether
// the radio offers it (wireless' he_twt_responder, which restarts the radio) and
// the limits of what it agrees to (milkflint.wifi.twt_<band>_*, for the Wi-Fi
// driver: features/wifi/bin/wifi-twt, at once, for new requests only). Outside
// them, a device is offered the nearest terms inside them. Unset is the driver's
// defaults, which is what Balanced is.

export type TwtTrigger = 'allow' | 'never';
export type TwtPreset = 'balanced' | 'responsive' | 'battery';

export interface TwtLimits {
  /** Longest sleep between wake periods, ms; 0 no limit */
  maxIntervalMs: number;
  /** Shortest, ms; 0 no limit */
  minIntervalMs: number;
  /** Least time awake in a wake period, in the driver's unit of 256 us */
  minWake: number;
  /** Agreements on the radio */
  flows: number;
  /** Agreements per device */
  staFlows: number;
  trigger: TwtTrigger;
}

export interface TwtSetting extends TwtLimits {
  /** The radio offers TWT */
  on: boolean;
  preset: TwtPreset | 'custom';
}

const BALANCED: TwtLimits = { maxIntervalMs: 60_000, minIntervalMs: 0, minWake: 64, flows: 16, staFlows: 8, trigger: 'allow' };

export const TWT_PRESETS: Record<TwtPreset, TwtLimits> = {
  balanced: BALANCED,
  responsive: { ...BALANCED, maxIntervalMs: 1_000 },
  // hostapd drops a device it hasn't heard from in 300 s (ap_max_inactivity)
  battery: { ...BALANCED, maxIntervalMs: 240_000 },
};

export const TWT_PRESET_LABELS: Record<TwtPreset | 'custom', string> = {
  balanced: 'Balanced',
  responsive: 'Responsive',
  battery: 'Longest battery',
  custom: 'Custom',
};

export function twtPresetHint(preset: TwtPreset | 'custom'): string {
  switch (preset) {
    case 'balanced':
      return 'Devices choose their own schedule, sleeping up to a minute at a time.';
    case 'responsive':
      return 'Devices wake at least once a second, so nothing waits long for them.';
    case 'battery':
      return 'Devices may sleep up to 4 minutes at a time. Anything sent to them waits that long. A group key change can drop one that sleeps through it; it joins again by itself.';
    case 'custom':
      return 'Limits of your own. Only new requests go by them: the agreements devices have stay until they end.';
  }
}

export const TWT_MAX_INTERVALS = [100, 500, 1_000, 2_000, 5_000, 10_000, 30_000, 60_000, 120_000, 240_000, 0] as const;
export const TWT_MIN_INTERVALS = [0, 10, 50, 100, 500, 1_000, 5_000, 10_000] as const;
export const TWT_MIN_WAKES = [64, 128, 192, 255] as const;
export const TWT_FLOWS = [1, 2, 4, 8, 16] as const;
export const TWT_STA_FLOWS = [1, 2, 4, 8] as const;

export const TWT_TRIGGER_LABELS: Record<TwtTrigger, string> = {
  allow: 'Allow',
  never: 'Never',
};

export function twtTriggerHint(trigger: TwtTrigger): string {
  switch (trigger) {
    case 'allow':
      return 'In a trigger-enabled schedule a device sends when the router asks, during its wake times. Many devices ask for these.';
    case 'never':
      return 'A device that asks for one is offered a schedule without. Try this if a device has trouble sending on a schedule.';
  }
}

export function twtIntervalLabel(ms: number): string {
  if (ms === 0) return 'No limit';
  if (ms < 1_000) return `${String(ms)} ms`;
  if (ms < 60_000) return `${String(ms / 1_000)} s`;
  return `${String(ms / 60_000)} min`;
}

/** The driver's 256 us units, as the page shows them */
export function twtWakeLabel(units: number): string {
  return `${String(Math.round((units * 256) / 1000))} ms`;
}

/** milkflint.wifi's option for one of a band's limits */
export function twtOption(band: string, name: string): string {
  return `twt_${band}_${name}`;
}

function whole(value: string | undefined, fallback: number): number {
  return value !== undefined && /^\d+$/.test(value) ? Number(value) : fallback;
}

function presetOf(l: TwtLimits): TwtPreset | 'custom' {
  const same = (a: TwtLimits): boolean =>
    a.maxIntervalMs === l.maxIntervalMs &&
    a.minIntervalMs === l.minIntervalMs &&
    a.minWake === l.minWake &&
    a.flows === l.flows &&
    a.staFlows === l.staFlows &&
    a.trigger === l.trigger;
  return (Object.keys(TWT_PRESETS) as TwtPreset[]).find((p) => same(TWT_PRESETS[p])) ?? 'custom';
}

/** The setting, from the radio's he_twt_responder and the band's driver limits */
export function twtOf(responder: string | undefined, get: (name: string) => string | undefined): TwtSetting {
  const trigger = get('trigger');
  const limits: TwtLimits = {
    maxIntervalMs: whole(get('max_interval'), BALANCED.maxIntervalMs),
    minIntervalMs: whole(get('min_interval'), BALANCED.minIntervalMs),
    minWake: whole(get('min_wake'), BALANCED.minWake),
    flows: whole(get('flows'), BALANCED.flows),
    staFlows: whole(get('sta_flows'), BALANCED.staFlows),
    trigger: trigger === 'never' ? 'never' : 'allow',
  };
  return { ...limits, on: responder !== '0', preset: presetOf(limits) };
}

/** A preset's limits, keeping whether the radio offers TWT at all */
export function twtWithPreset(s: TwtSetting, preset: TwtPreset | 'custom'): TwtSetting {
  return preset === 'custom' ? { ...s, preset } : { ...s, ...TWT_PRESETS[preset], preset };
}

/** wireless' option for the radio; undefined: unset, OpenWrt's default (on) */
export function twtRadioOptions(s: TwtSetting): { he_twt_responder: string | undefined } {
  return { he_twt_responder: s.on ? undefined : '0' };
}

/** milkflint.wifi's options for a band; undefined: unset, the driver's default */
export function twtDriverOptions(band: string, s: TwtLimits): Record<string, string | undefined> {
  const num = (value: number, fallback: number): string | undefined => (value === fallback ? undefined : String(value));
  return {
    [twtOption(band, 'max_interval')]: num(s.maxIntervalMs, BALANCED.maxIntervalMs),
    [twtOption(band, 'min_interval')]: num(s.minIntervalMs, BALANCED.minIntervalMs),
    [twtOption(band, 'min_wake')]: num(s.minWake, BALANCED.minWake),
    [twtOption(band, 'flows')]: num(s.flows, BALANCED.flows),
    [twtOption(band, 'sta_flows')]: num(s.staFlows, BALANCED.staFlows),
    [twtOption(band, 'trigger')]: s.trigger === BALANCED.trigger ? undefined : s.trigger,
  };
}

/** The choices to offer, with a value set some other way among them */
export function twtChoices(all: readonly number[], current: number): number[] {
  return all.includes(current) ? [...all] : [...all, current].sort((a, b) => a - b);
}

/** Longest sleeps that aren't shorter than the shortest: the driver refuses those */
export function twtMaxChoices(s: TwtLimits): number[] {
  return twtChoices(TWT_MAX_INTERVALS, s.maxIntervalMs).filter((ms) => ms === 0 || ms >= s.minIntervalMs);
}

export function twtMinChoices(s: TwtLimits): number[] {
  return twtChoices(TWT_MIN_INTERVALS, s.minIntervalMs).filter((ms) => s.maxIntervalMs === 0 || ms <= s.maxIntervalMs);
}

/** A radio's restart only comes from what changes hostapd's config: the limits are the driver's, at once. */
export function twtRestarts(a: TwtSetting, b: TwtSetting): boolean {
  return a.on !== b.on;
}

/** "Sleeps 1 s, awake 16 ms" for an agreement */
export function twtScheduleLabel(intervalUs: number, wakeUs: number): string {
  const sleep = (intervalUs - wakeUs) / 1000;
  const part = (ms: number): string => (ms < 1000 ? `${String(Math.round(ms))} ms` : ms < 60_000 ? `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s` : `${(ms / 60_000).toFixed(1)} min`);
  return `Sleeps ${part(sleep)}, awake ${part(wakeUs / 1000)}`;
}
