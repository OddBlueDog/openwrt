// Whether Smart Queue's download CAKE takes GRO packets whole (CAKE's
// no-split-gso in sqm's iqdisc_opts) or splits each one back into packets
// (split-gso, CAKE's default). The Smart Queue page writes it with the speed,
// the Performance Tuning page when its setting changes; both decide it here.
//
// Automatic is from 500 Mbit/s: a 64 KB GRO packet holds a CAKE queue ~1 ms
// at 500 Mbit/s, and taking it whole saves CPU at those speeds.
// milkflint.gro.whole "1" or "0" overrides it.

export const NO_SPLIT_GSO_KBIT = 500_000;

/** CAKE's two keywords for it, managed together in iqdisc_opts */
export const GSO = ['split-gso', 'no-split-gso'];

export type Whole = 'auto' | 'on' | 'off';

/** milkflint.gro.whole as a choice: anything but "1" or "0" is automatic */
export function wholeSetting(value: string | undefined): Whole {
  return value === '1' ? 'on' : value === '0' ? 'off' : 'auto';
}

/** milkflint.gro.whole for a choice; undefined: unset */
export function wholeValue(whole: Whole): string | undefined {
  return whole === 'on' ? '1' : whole === 'off' ? '0' : undefined;
}

/** Whether CAKE takes GRO packets whole at this download speed (kbit/s). */
export function takesWhole(downloadKbit: number, whole: Whole): boolean {
  return whole === 'auto' ? downloadKbit >= NO_SPLIT_GSO_KBIT : whole === 'on';
}

export const words = (opts: string | undefined): string[] => (opts ?? '').split(/\s+/).filter((w) => w !== '');

/** CAKE keywords followed by a value (rtt 50ms): a managed one goes with its value */
const TAKES_VALUE = ['rtt', 'memlimit', 'mpu', 'overhead', 'fwmark'];

/** the value after a CAKE keyword in opts, e.g. "50ms" for rtt */
export function optValue(opts: string | undefined, keyword: string): string | undefined {
  const w = words(opts);
  const i = w.indexOf(keyword);
  return i < 0 ? undefined : (w[i + 1] ?? '');
}

/** opts with the managed keywords replaced by the wanted ones; others (set in LuCI) are kept */
export function withOpts(current: string | undefined, managed: string[], wanted: string[]): string {
  const kept: string[] = [];
  const w = words(current);
  for (let i = 0; i < w.length; i++) {
    const word = w[i] ?? '';
    if (!managed.includes(word)) kept.push(word);
    else if (TAKES_VALUE.includes(word)) i++;
  }
  return [...kept, ...wanted].join(' ');
}
