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
// - wifi.retries: how many times the Wi-Fi driver sends a data frame
//   before it gives up, 1 to 31; unset 15.
// No imports from the app, so the tests (ui/tests) load it as it is.

export interface Knobs {
  wifiAll: boolean;
  ringsRt: boolean;
  /** µs as text; '' for the default, 40 */
  rxDelay: string;
  /** ignored marks as text; '' for the default, 8; '0' never drops */
  ecnDrop: string;
  /** sends as text; '' for the default, 15 */
  retries: string;
}

export const knobDefaults: Knobs = { wifiAll: true, ringsRt: true, rxDelay: '', ecnDrop: '', retries: '' };

export const RX_DELAY_DEFAULT = 40;
export const RETRIES_DEFAULT = 15;
export const ECN_DROP_DEFAULT = 8;

/** The interrupt delays the page offers: '' is the default, '0' no limit */
export const rxDelayChoices = ['', '20', '80', '160', '0'];
/** The retry limits the page offers: '' is the default */
export const retryChoices = ['', '10', '7', '4'];
/** When the page offers to drop from downloads that ignore ECN marks: '' is the default, '0' never */
export const ecnDropChoices = ['', '16', '64', '256', '0'];

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

/** The settings as the router's scripts read them: whatever they'd ignore is the default. */
export function readKnobs(get: Get): Knobs {
  return {
    wifiAll: get('steering', 'wifi_all') !== '0',
    ringsRt: get('steering', 'rings_rt') !== '0',
    rxDelay: numberOrDefault(get('steering', 'rx_delay'), 0, 1000, RX_DELAY_DEFAULT),
    ecnDrop: ecnDropOf(get('cake', 'ecn_drop')),
    retries: numberOrDefault(get('wifi', 'retries'), 1, 31, RETRIES_DEFAULT),
  };
}

/** The milkflint options for the settings, by section; undefined is unset, the default. */
export interface KnobOptions {
  steering: { wifi_all: string | undefined; rings_rt: string | undefined; rx_delay: string | undefined };
  cake: { ecn_drop: string | undefined };
  wifi: { retries: string | undefined };
}

export function knobOptions(k: Knobs): KnobOptions {
  return {
    steering: {
      wifi_all: k.wifiAll ? undefined : '0',
      rings_rt: k.ringsRt ? undefined : '0',
      rx_delay: k.rxDelay === '' ? undefined : k.rxDelay,
    },
    cake: { ecn_drop: k.ecnDrop === '' ? undefined : k.ecnDrop },
    wifi: { retries: k.retries === '' ? undefined : k.retries },
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

/** What sch_cake does now, from its ecn_fail_count (null: not loaded, or without the parameter) */
export function ecnNow(count: number | null, loaded: boolean): string {
  if (count === null) return loaded ? 'Not in this image' : 'Smart Queue hasn’t run since the router started';
  return count === 0
    ? 'Marks every ECN download (as CAKE upstream)'
    : `Drops from ECN downloads after ${String(count)} ignored marks (${ecnDropTime(count)})`;
}
