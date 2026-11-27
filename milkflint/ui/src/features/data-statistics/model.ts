// What the Data usage page shows from nlbwmon's table: the rows for the view
// (the router's own traffic isn't a device's), one device's when a link
// asked for it, and their totals.
import { z } from 'zod';
import type { Change } from '@/lib/api/uci';
import type { DataUsageSettings, UsageRow } from './api';

export type View = 'devices' | 'apps';

/** A MAC address from the page's path (#/data-statistics/<mac>), lower case; anything else: none. */
export function macFromPath(sub: string): string | undefined {
  const mac = decodeURIComponent(sub).trim().toLowerCase();
  return /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/.test(mac) ? mac : undefined;
}

/**
 * The rows to show: by application, all of them; by device, without the
 * router's own addresses, and only `mac`'s when one is given.
 */
export function shownRows(
  rows: readonly UsageRow[],
  view: View,
  routerIps: ReadonlySet<string> | undefined,
  mac: string | undefined,
): UsageRow[] {
  if (view === 'apps') return [...rows];
  return rows.filter(
    (r) => (r.ip === undefined || routerIps?.has(r.ip) !== true) && (mac === undefined || r.key.toLowerCase() === mac),
  );
}

export function totals(rows: readonly UsageRow[]): { rx: number; tx: number } {
  return rows.reduce((t, r) => ({ rx: t.rx + r.rx, tx: t.tx + r.tx }), { rx: 0, tx: 0 });
}

/** The MACs (lower case) whose rows are the router's own, as `shownRows` leaves them out: the history hides them too. */
export function routerMacs(rows: readonly UsageRow[], routerIps: ReadonlySet<string> | undefined): Set<string> {
  return new Set(rows.filter((r) => r.ip !== undefined && routerIps?.has(r.ip) === true).map((r) => r.key.toLowerCase()));
}

/** Counting's form: on or off, the 24-hour history, and the day the count starts again. */
export const dataUsageFormSchema = z.object({
  enabled: z.boolean(),
  day: z.string(),
  /** milkflint.datastats.history: the opt-in 24-hour history */
  history: z.boolean(),
});

export type DataUsageForm = z.infer<typeof dataUsageFormSchema>;

export function toForm(s: DataUsageSettings): DataUsageForm {
  return { enabled: s.enabled, day: s.day, history: s.history };
}

export function toChanges(f: DataUsageForm, data: DataUsageSettings): Change[] {
  const changes: Change[] = [];
  if (f.enabled !== data.enabled) {
    changes.push({ op: 'set', config: 'milkflint', section: 'datastats', values: { enabled: f.enabled ? '1' : '0' } });
  }
  if (f.history !== data.history) {
    changes.push({ op: 'set', config: 'milkflint', section: 'datastats', values: { history: f.history ? '1' : '0' } });
  }
  if (f.day !== data.day && data.section !== undefined) {
    changes.push({ op: 'set', config: 'nlbwmon', section: data.section, values: { database_interval: f.day } });
  }
  return changes;
}
