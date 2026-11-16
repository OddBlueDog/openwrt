// What the Data usage page shows from nlbwmon's table: the rows for the view
// (the router's own traffic isn't a device's), one device's when a link
// asked for it, and their totals.
import type { UsageRow } from './api';

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
