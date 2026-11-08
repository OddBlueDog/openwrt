// What the UCI model tests share: the sections a page's wanted() or changes
// would leave on the router, to test the next save against.
import type { Wanted } from '../src/lib/api/owned.ts';
import type { Change, Section } from '../src/lib/api/uci.ts';

/** A section as uci reads it back. */
export function section(type: string, name: string, values: Record<string, string | string[]> = {}): Section {
  return { '.type': type, '.name': name, ...values };
}

/** `wanted` as it would be on the router after a save, by config. */
export function presentOf(wanted: readonly Wanted[]): Record<string, Section[]> {
  const out: Record<string, Section[]> = {};
  for (const w of wanted) {
    const values = Object.fromEntries(Object.entries(w.values).filter((e): e is [string, string | string[]] => e[1] !== undefined));
    (out[w.config] ??= []).push(section(w.type, w.name, values));
  }
  return out;
}

/** `changes` applied to `before` as uci would: what a page's next load sees. */
export function applied(before: Readonly<Record<string, readonly Section[]>>, changes: readonly Change[]): Record<string, Section[]> {
  const out: Record<string, Section[]> = Object.fromEntries(Object.entries(before).map(([k, v]) => [k, v.map((s) => ({ ...s }))]));
  for (const c of changes) {
    const sections = (out[c.config] ??= []);
    if (c.op === 'add') {
      sections.push(section(c.type, c.name ?? `cfg${String(sections.length)}`, c.values));
    } else if (c.op === 'delete') {
      out[c.config] = sections.filter((s) => s['.name'] !== c.section);
    } else if (c.op === 'order') {
      sections.sort((a, b) => c.sections.indexOf(a['.name']) - c.sections.indexOf(b['.name']));
    } else {
      const s = sections.find((x) => x['.name'] === c.section);
      if (s === undefined) throw new Error(`${c.op} of a section that isn't there: ${c.config}.${c.section}`);
      if (c.op === 'set') Object.assign(s, c.values);
      else for (const o of c.options) Reflect.deleteProperty(s, o);
    }
  }
  return out;
}

/** A change's section name, whichever kind it is. */
export function nameOf(c: Change): string | undefined {
  if (c.op === 'add') return c.name;
  return c.op === 'order' ? undefined : c.section;
}
