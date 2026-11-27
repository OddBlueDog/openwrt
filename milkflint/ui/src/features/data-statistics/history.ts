// Data usage's 24-hour history (opt-in): what each device downloaded and
// uploaded over the last 1, 4, 8 and 24 hours, and a chart of it over the
// day. The router keeps a sample every 5 minutes, only for the steps where
// something moved, and deletes them after a day.
import { z } from 'zod';
import { createElement, type ReactNode } from 'react';
import type { Column } from '@/components/data-table';
import type { TimePoint } from '@/components/charts/time-axis';
import { Arrowed } from '@/components/dir';
import { call } from '@/lib/ubus';
import { formatBytes } from '@/lib/format';
import { UNNAMED_DEVICE } from '../clients/model';

/** Seconds between samples. */
export const STEP = 300;
export const DAY = 86_400;
/** How often the page asks: the router only has something new every STEP. */
export const HISTORY_POLL_MS = 300_000;

const pair = z.tuple([z.number(), z.number()]);

const historySchema = z.object({
  on: z.boolean(),
  since: z.number().nullable(),
  windows: z.record(z.string(), z.object({ h1: pair, h4: pair, h8: pair, h24: pair })),
  series: z.array(z.tuple([z.number(), z.number(), z.number()])),
});

export type History = z.output<typeof historySchema>;
export type Windows = History['windows'][string];

/** The history for one device (its MAC), or for all of them together (''). */
export function getHistory(mac = ''): Promise<History> {
  return call('milkflint.traffic', 'history', { mac }, historySchema);
}

export interface WindowRow {
  mac: string;
  name: string | undefined;
  h1: [number, number];
  h4: [number, number];
  h8: [number, number];
  h24: [number, number];
}

const NO_MAC = '00:00:00:00:00:00';

/**
 * One row per device, busiest 24 hours (download + upload) first. The
 * all-zero bucket and the MACs in `hide` (the router's own) aren't devices.
 */
export function windowRows(h: History, names: ReadonlyMap<string, string>, hide: ReadonlySet<string> = new Set()): WindowRow[] {
  const hidden = new Set([NO_MAC, ...[...hide].map((m) => m.toLowerCase())]);
  return Object.entries(h.windows)
    .map(([key, w]) => ({ mac: key.toLowerCase(), name: names.get(key.toLowerCase()), h1: w.h1, h4: w.h4, h8: w.h8, h24: w.h24 }))
    .filter((r) => !hidden.has(r.mac))
    .sort((a, b) => b.h24[0] + b.h24[1] - (a.h24[0] + a.h24[1]));
}

/** "↓ 1.5 KB · ↑ 1.0 KB" */
export const volume = (v: readonly [number, number]): string => `↓ ${formatBytes(v[0])} · ↑ ${formatBytes(v[1])}`;

/** The same, with the arrows drawn and said as "download" and "upload". */
export const volumeCell = (v: readonly [number, number]): ReactNode => createElement(Arrowed, { text: volume(v) });

const total = (v: readonly [number, number]): number => v[0] + v[1];
const windowColumn = (label: string, of: (r: WindowRow) => readonly [number, number], compact?: boolean): Column<WindowRow> => ({
  label,
  cell: (r) => volumeCell(of(r)),
  sort: (r) => total(of(r)),
  sortDescFirst: true,
  sortLabel: `Most in ${label} first`,
  className: 'tabular whitespace-nowrap',
  compact,
});

export const windowColumns: readonly Column<WindowRow>[] = [
  { label: 'Device', cell: (r) => r.name ?? `${UNNAMED_DEVICE} ${r.mac}`, sort: (r) => r.name, compact: true },
  windowColumn('1 h', (r) => r.h1),
  windowColumn('4 h', (r) => r.h4),
  windowColumn('8 h', (r) => r.h8),
  windowColumn('24 h', (r) => r.h24, true),
];

/**
 * "History since 09:05" while it has run less than a day; nothing once it has run about that long (or isn't
 * running). The router only reads samples under 24 hours old, so its "since" never quite reaches a day:
 * it is hidden within two steps of one.
 */
export function sinceText(since: number | null, now: number): string {
  if (since === null || now - since >= DAY - 2 * STEP) return '';
  const at = new Date(since * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return `History since ${at}`;
}

export interface ChartData {
  from: number;
  to: number;
  /** Bits per second over each 5-minute step; null before the history began. */
  down: TimePoint[];
  up: TimePoint[];
}

/**
 * The chart over [now - 24 h, now] in 5-minute steps. A step with no sample
 * is 0 once the history was running (at or after `since`), and nothing before.
 */
export function chartSeries(h: History, now: number): ChartData {
  const from = now - DAY;
  const first = Math.floor(from / STEP) * STEP;
  const last = Math.floor(now / STEP) * STEP;
  const began = h.since === null ? Infinity : Math.floor(h.since / STEP) * STEP;
  const sums = new Map<number, [number, number]>();
  for (const [t, d, u] of h.series) {
    const k = Math.floor(t / STEP) * STEP;
    const s = sums.get(k) ?? [0, 0];
    sums.set(k, [s[0] + d, s[1] + u]);
  }
  const down: TimePoint[] = [];
  const up: TimePoint[] = [];
  for (let t = first; t <= last; t += STEP) {
    if (t < began) {
      down.push([t, null]);
      up.push([t, null]);
      continue;
    }
    const s = sums.get(t) ?? [0, 0];
    down.push([t, (s[0] * 8) / STEP]);
    up.push([t, (s[1] * 8) / STEP]);
  }
  return { from, to: now, down, up };
}
