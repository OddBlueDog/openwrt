// What the UCI model tests share: the sections a page's wanted() or changes
// would leave on the router, to test the next save against.
import type { Wanted } from '../src/lib/api/owned.ts';
import type { Change, Section } from '../src/lib/api/uci.ts';

/** A section as uci reads it back. */
export function section(type: string, name: string, values: Record<string, string | string[]> = {}): Section {
  return { '.type': type, '.name': name, ...values };
}

// uci can't keep an empty option: setting one to '' deletes it (libuci's uci_set).
const kept = (e: [string, string | string[] | undefined]): e is [string, string | string[]] => e[1] !== undefined && e[1] !== '';

/** `wanted` as it would be on the router after a save, by config. */
export function presentOf(wanted: readonly Wanted[]): Record<string, Section[]> {
  const out: Record<string, Section[]> = {};
  for (const w of wanted) {
    const values = Object.fromEntries(Object.entries(w.values).filter(kept));
    (out[w.config] ??= []).push(section(w.type, w.name, values));
  }
  return out;
}

/** `changes` applied to `before` as uci would: what a page's next load sees. */
export function applied(
  before: Readonly<Record<string, readonly Section[]>>,
  changes: readonly Change[],
): Record<string, Section[]> {
  const out: Record<string, Section[]> = Object.fromEntries(
    Object.entries(before).map(([k, v]) => [k, v.map((s) => ({ ...s }))]),
  );
  for (const c of changes) {
    const sections = (out[c.config] ??= []);
    if (c.op === 'add') {
      sections.push(
        section(c.type, c.name ?? `cfg${String(sections.length)}`, Object.fromEntries(Object.entries(c.values).filter(kept))),
      );
    } else if (c.op === 'delete') {
      out[c.config] = sections.filter((s) => s['.name'] !== c.section);
    } else if (c.op === 'order') {
      sections.sort((a, b) => c.sections.indexOf(a['.name']) - c.sections.indexOf(b['.name']));
    } else {
      const s = sections.find((x) => x['.name'] === c.section);
      if (s === undefined) throw new Error(`${c.op} of a section that isn't there: ${c.config}.${c.section}`);
      if (c.op === 'set') {
        for (const [o, v] of Object.entries(c.values)) {
          if (kept([o, v])) s[o] = v;
          else Reflect.deleteProperty(s, o);
        }
      } else for (const o of c.options) Reflect.deleteProperty(s, o);
    }
  }
  return out;
}

/** A change's section name, whichever kind it is. */
export function nameOf(c: Change): string | undefined {
  if (c.op === 'add') return c.name;
  return c.op === 'order' ? undefined : c.section;
}
