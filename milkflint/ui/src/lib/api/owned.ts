// Sections a page makes and keeps up, known by their names. The page works
// out from its settings the whole set it needs, and reconcile() turns that
// into changes against what the router has: missing sections added under
// their names, options that differ set back, and owned sections the
// settings no longer need deleted. It only touches the options a page
// manages, so they stay plain OpenWrt config that LuCI shows and edits, and
// options added there are kept.
import type { Change, Section } from './uci';

export type Values = Record<string, string | string[] | undefined>;

/** One section as the settings need it: undefined values are unset. */
export interface Wanted {
  config: string;
  type: string;
  name: string;
  values: Values;
}

export interface Owned {
  config: string;
  name: string;
}

// One value given as a one-item list is the same, as UCI's readers take both.
function same(a: string | string[] | undefined, b: string | string[]): boolean {
  if (a === undefined) return false;
  const x = typeof a === 'string' ? [a] : a;
  const y = typeof b === 'string' ? [b] : b;
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

/** Changes that make `section` hold `values` (an add when it's missing). */
export function sectionChanges(w: Wanted, section: Section | undefined): Change[] {
  const set: Record<string, string | string[]> = {};
  const unset: string[] = [];
  for (const [option, value] of Object.entries(w.values)) {
    if (value === undefined || (Array.isArray(value) && value.length === 0)) {
      if (section?.[option] !== undefined) unset.push(option);
    } else if (!same(section?.[option], value)) {
      set[option] = value;
    }
  }
  if (section === undefined) return [{ op: 'add', config: w.config, type: w.type, name: w.name, values: set }];
  const changes: Change[] = [];
  if (Object.keys(set).length > 0) changes.push({ op: 'set', config: w.config, section: w.name, values: set });
  if (unset.length > 0) changes.push({ op: 'unset', config: w.config, section: w.name, options: unset });
  return changes;
}

/**
 * The changes from what `present` (config -> its sections) has to `wanted`;
 * sections in `owned` that aren't wanted any more are deleted.
 */
export function reconcile(wanted: readonly Wanted[], owned: readonly Owned[], present: Readonly<Record<string, readonly Section[] | undefined>>): Change[] {
  const find = (config: string, name: string): Section | undefined => present[config]?.find((s) => s['.name'] === name);
  const changes = wanted.flatMap((w) => sectionChanges(w, find(w.config, w.name)));
  for (const o of owned) {
    if (!wanted.some((w) => w.config === o.config && w.name === o.name) && find(o.config, o.name) !== undefined) {
      changes.push({ op: 'delete', config: o.config, section: o.name });
    }
  }
  return changes;
}

/** A wanted section's name already taken by a section of another type (made in LuCI, say). */
export function nameClashes(wanted: readonly Wanted[], present: Readonly<Record<string, readonly Section[] | undefined>>): Wanted[] {
  return wanted.filter((w) => {
    const s = present[w.config]?.find((x) => x['.name'] === w.name);
    return s !== undefined && s['.type'] !== w.type;
  });
}
