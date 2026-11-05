// MilkFlint's latency settings on the Performance Tuning page, as milkflint
// options (router side: features/tuning/init and the scripts it runs).
// Unset is what the image does:
// - steering.wifi_all "0": with RSS, the Wi-Fi driver's threads keep to
//   CPUs 1-3 (unset: every CPU);
// - steering.rings_rt "0": the RSS rings' receive threads at normal priority
//   (unset: real-time);
// - steering.rx_delay: the longest the Ethernet's receive interrupt waits,
//   in µs; "0" no limit (the driver's adaptive choice, up to 260 µs); unset 40;
// - cake.ecn_drop: after how many ignored marks Smart Queue drops from an
//   ECN download that ignores them, 8 to 65535 (sch_cake's ecn_fail_count);
//   "0" never, it always marks; unset 8;
// - cake.l4s: where L4S traffic starts to be marked by how long each packet
//   has waited, in percent of Smart Queue's target, 20 to 400 (sch_cake's
//   l4s_ramp); "0" not at all, only classic CAKE's marks; unset 100;
// - wifi.retries: how many times the Wi-Fi driver sends a data frame
//   before it gives up, 1 to 31; unset 15;
// - wifi.vo_aggr: whether the Wi-Fi driver aggregates the voice queue, "0" not,
//   as stock OpenWrt's mt76; unset or anything else, it does.
// And the Wi-Fi queue's total, which goes with its limits (aql_be, on the page):
// - wifi.aql_threshold: the radio's total that holds devices to their low
//   limit, from the high limit to 50,000 µs; unset 1.2 times the high limit,
//   or mac80211's own with its limits.
// No imports from the app, so the tests (ui/tests) load it as it is.

export interface Knobs {
  wifiAll: boolean;
  ringsRt: boolean;
  /** µs as text; '' for the default, 40 */
  rxDelay: string;
  /** ignored marks as text; '' for the default, 8; '0' never drops */
  ecnDrop: string;
  /** percent of the target as text; '' for the default, 100; '0' off */
  l4s: string;
  /** sends as text; '' for the default, 15 */
  retries: string;
  /** '1' on, '0' off; '' for automatic, on with Smart Queue's restored DSCP */
  voAggr: string;
}

export const knobDefaults: Knobs = { wifiAll: true, ringsRt: true, rxDelay: '', ecnDrop: '', l4s: '', retries: '', voAggr: '' };

export const RX_DELAY_DEFAULT = 40;
export const RETRIES_DEFAULT = 15;
export const ECN_DROP_DEFAULT = 8;
export const L4S_DEFAULT = 100;

/** The interrupt delays the page offers: '' is the default, '0' no limit */
export const rxDelayChoices = ['', '20', '80', '160', '0'];
/** The retry limits the page offers: '' is the default */
export const retryChoices = ['', '10', '7', '4'];
/** When the page offers to drop from downloads that ignore ECN marks: '' is the default, '0' never */
export const ecnDropChoices = ['', '16', '64', '256', '0'];
/** Where the page offers to start marking L4S traffic: '' is the default, '0' not at all */
export const l4sChoices = ['', '60', '200', '0'];

/** Whether to aggregate the voice queue: '' is the default */
export const voAggrChoices = ['', '0'];

/** A milkflint option: section and option name to its value, undefined if unset */
export type Get = (section: string, option: string) => string | undefined;

/** A whole number in [min, max], other than the default, as text; '' otherwise */
function numberOrDefault(value: string | undefined, min: number, max: number, dflt: number): string {
  if (value === undefined || !/^\d{1,4}$/.test(value)) return '';
  const n = Number(value);
  return n < min || n > max || n === dflt ? '' : String(n);
}

/** cake.ecn_drop as features/tuning/bin/cake-ecn reads it: "0", or 8 to 65535 other than the default; '' otherwise */
function ecnDropOf(value: string | undefined): string {
  if (value === undefined || !/^\d{1,6}$/.test(value)) return '';
  const n = Number(value);
  if (n === 0) return '0';
  return n < ECN_DROP_DEFAULT || n > 65535 || n === ECN_DROP_DEFAULT ? '' : String(n);
}

/** cake.l4s as features/tuning/bin/cake-ecn reads it: "0", or 20 to 400 other than the default; '' otherwise */
function l4sOf(value: string | undefined): string {
  if (value === undefined || !/^\d{1,6}$/.test(value)) return '';
  const n = Number(value);
  if (n === 0) return '0';
  return n < 20 || n > 400 || n === L4S_DEFAULT ? '' : String(n);
}

/** wifi.vo_aggr as features/tuning/bin/wifi-vo-aggr reads it: "0"; '' otherwise */
function voAggrOf(value: string | undefined): string {
  return value === '0' ? value : '';
}

/** The settings as the router's scripts read them: whatever they'd ignore is the default. */
export function readKnobs(get: Get): Knobs {
  return {
    wifiAll: get('steering', 'wifi_all') !== '0',
    ringsRt: get('steering', 'rings_rt') !== '0',
    rxDelay: numberOrDefault(get('steering', 'rx_delay'), 0, 1000, RX_DELAY_DEFAULT),
    ecnDrop: ecnDropOf(get('cake', 'ecn_drop')),
    l4s: l4sOf(get('cake', 'l4s')),
    retries: numberOrDefault(get('wifi', 'retries'), 1, 31, RETRIES_DEFAULT),
    voAggr: voAggrOf(get('wifi', 'vo_aggr')),
  };
}

/** The milkflint options for the settings, by section; undefined is unset, the default. */
export interface KnobOptions {
  steering: { wifi_all: string | undefined; rings_rt: string | undefined; rx_delay: string | undefined };
  cake: { ecn_drop: string | undefined; l4s: string | undefined };
  wifi: { retries: string | undefined; vo_aggr: string | undefined };
}

export function knobOptions(k: Knobs): KnobOptions {
  return {
    steering: {
      wifi_all: k.wifiAll ? undefined : '0',
      rings_rt: k.ringsRt ? undefined : '0',
      rx_delay: k.rxDelay === '' ? undefined : k.rxDelay,
    },
    cake: { ecn_drop: k.ecnDrop === '' ? undefined : k.ecnDrop, l4s: k.l4s === '' ? undefined : k.l4s },
    wifi: { retries: k.retries === '' ? undefined : k.retries, vo_aggr: k.voAggr === '' ? undefined : k.voAggr },
  };
}

/** Which sections' options differ between two forms */
export function knobSectionsChanged(a: Knobs, b: Knobs): Set<'steering' | 'cake' | 'wifi'> {
  const x = knobOptions(a);
  const y = knobOptions(b);
  const changed = new Set<'steering' | 'cake' | 'wifi'>();
  for (const section of ['steering', 'cake', 'wifi'] as const) {
    if (JSON.stringify(x[section]) !== JSON.stringify(y[section])) changed.add(section);
  }
  return changed;
}

/** "40 µs", "No limit (up to 260 µs)" */
export function rxDelayLabel(value: string | number): string {
  const us = value === '' ? RX_DELAY_DEFAULT : Number(value);
  return us === 0 ? 'No limit (up to 260 µs)' : `${String(us)} µs`;
}

/** "15 sends" */
/** A choice of voice queue aggregation */
export function voAggrLabel(value: string): string {
  return value === '0' ? 'Off, as stock OpenWrt' : 'On (default)';
}

export function retriesLabel(value: string | number): string {
  const n = value === '' ? RETRIES_DEFAULT : Number(value);
  return `${String(n)} send${n === 1 ? '' : 's'}`;
}

/** How long a download ignores the marks before it's dropped from, at CAKE's
 * default rtt of 100 ms: CoDel's count reaches n after about
 * 2 * rtt * sqrt(n) of marks, "about 0.6 s" for 8 */
function ecnDropTime(n: number): string {
  const s = 0.2 * Math.sqrt(n);
  return `about ${s < 10 ? s.toFixed(1) : String(Math.round(s))} s`;
}

/** "After 8 ignored marks, about 0.6 s", "Never: always marks" */
export function ecnDropLabel(value: string | number): string {
  const n = value === '' ? ECN_DROP_DEFAULT : Number(value);
  return n === 0 ? 'Never: always marks' : `After ${String(n)} ignored marks, ${ecnDropTime(n)}`;
}

/** "2.5", with no more decimals than it needs */
function msText(ms: number): string {
  return String(Math.round(ms * 100) / 100);
}

/**
 * "From 5 ms, every packet by 10 ms": where a percent of Smart Queue's target
 * (targetMs, null if it isn't known) puts the marking of L4S traffic.
 */
export function l4sLabel(value: string | number, targetMs: number | null): string {
  const percent = value === '' ? L4S_DEFAULT : Number(value);
  if (percent === 0) return 'Off: only CAKE’s classic marks';
  if (targetMs === null) return `From ${String(percent)}% of Smart Queue’s target, every packet by twice that`;
  const from = (targetMs * percent) / 100;
  return `From ${msText(from)} ms, every packet by ${msText(2 * from)} ms`;
}

/** What sch_cake does with L4S traffic now, from its l4s_ramp (null: not loaded, or without the parameter) */
export function l4sNow(ramp: number | null, loaded: boolean, targetMs: number | null): string {
  if (ramp === null) return loaded ? 'Not in this image' : 'Smart Queue hasn’t run since the router started';
  return ramp === 0 ? 'Only CAKE’s classic marks (as CAKE upstream)' : l4sLabel(ramp, targetMs);
}

/** mac80211's own total for a radio's AQL, µs */
export const AQL_OWN_TOTAL = 24_000;

export type AqlTotal = 'auto' | 'own' | 'custom';

/** wifi.aql_threshold as a choice: as features/tuning/bin/wifi-aql reads it, anything but a number is automatic */
export function aqlTotalOf(value: string | undefined): { aqlTotal: AqlTotal; aqlTotalCustom: string } {
  if (value === undefined || !/^\d{1,6}$/.test(value)) return { aqlTotal: 'auto', aqlTotalCustom: '' };
  const n = Number(value);
  return n === AQL_OWN_TOTAL ? { aqlTotal: 'own', aqlTotalCustom: '' } : { aqlTotal: 'custom', aqlTotalCustom: String(n) };
}

/** wifi.aql_threshold for a choice; undefined: unset, automatic */
export function aqlTotalValue(total: AqlTotal, custom: string): string | undefined {
  if (total === 'auto') return undefined;
  return total === 'own' ? String(AQL_OWN_TOTAL) : String(Number(custom));
}

/** The total automatic gives, as wifi-aql works it out: "off" (mac80211's limits) keeps mac80211's own */
export function aqlAutoTotal(high: number, ownLimits: boolean): number {
  return ownLimits ? AQL_OWN_TOTAL : Math.floor((high * 6) / 5);
}

/** What's wrong with a total under this high limit; undefined if nothing is */
export function aqlTotalError(total: AqlTotal, custom: string, high: number): string | undefined {
  if (total === 'auto') return undefined;
  if (total === 'own') return high > AQL_OWN_TOTAL ? 'At least the high limit.' : undefined;
  if (!/^\d{1,6}$/.test(custom) || Number(custom) > 50_000) return 'Whole microseconds, up to 50,000.';
  return Number(custom) < high ? 'At least the high limit: less would hold back a device on its own.' : undefined;
}

/** What sch_cake does now, from its ecn_fail_count (null: not loaded, or without the parameter) */
export function ecnNow(count: number | null, loaded: boolean): string {
  if (count === null) return loaded ? 'Not in this image' : 'Smart Queue hasn’t run since the router started';
  return count === 0
    ? 'Marks every ECN download (as CAKE upstream)'
    : `Drops from ECN downloads after ${String(count)} ignored marks (${ecnDropTime(count)})`;
}
