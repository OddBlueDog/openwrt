// Home's widgets by id, and the grid classes a layout's spans become. Plain
// data with no React, so the tests can check every theme's layout against it.
// A theme places widgets by these ids (src/theme/themes/*.ts, dashboard).
import type { DashboardWidget } from '@/theme/contract';

/** The full widgets: every theme with a full Home places all of them. */
export const FULL_WIDGET_IDS = [
  'responsiveness',
  'internet',
  'wifi',
  'devices',
  'cpu',
  'memory',
  'temperatures',
  'system',
  'path',
  'throughput',
  'radios',
  'busiest-devices',
  'internet-details',
  'usage',
  'smart-queue',
] as const;

/** One word or number each, and one traffic line: a calm Home (dashboard.reduced) places these. */
export const GLANCE_WIDGET_IDS = [
  'glance-internet',
  'glance-responsiveness',
  'glance-wifi',
  'glance-devices',
  'glance-traffic',
] as const;

export const WIDGET_IDS = [...FULL_WIDGET_IDS, ...GLANCE_WIDGET_IDS] as const;
export type WidgetId = (typeof WIDGET_IDS)[number];

export function isWidgetId(id: string): id is WidgetId {
  return (WIDGET_IDS as readonly string[]).includes(id);
}

// Tailwind writes only the classes it finds in the source, so every span is
// spelt out here rather than built from a number.
const BASE = [
  'col-span-1',
  'col-span-2',
  'col-span-3',
  'col-span-4',
  'col-span-5',
  'col-span-6',
  'col-span-7',
  'col-span-8',
  'col-span-9',
  'col-span-10',
  'col-span-11',
  'col-span-12',
] as const;
const MD = [
  'md:col-span-1',
  'md:col-span-2',
  'md:col-span-3',
  'md:col-span-4',
  'md:col-span-5',
  'md:col-span-6',
  'md:col-span-7',
  'md:col-span-8',
  'md:col-span-9',
  'md:col-span-10',
  'md:col-span-11',
  'md:col-span-12',
] as const;
const XL = [
  'xl:col-span-1',
  'xl:col-span-2',
  'xl:col-span-3',
  'xl:col-span-4',
  'xl:col-span-5',
  'xl:col-span-6',
  'xl:col-span-7',
  'xl:col-span-8',
  'xl:col-span-9',
  'xl:col-span-10',
  'xl:col-span-11',
  'xl:col-span-12',
] as const;

/** A whole number of columns from 1 to 12 (anything else is the full width). */
function columns(n: number): number {
  return Number.isInteger(n) && n >= 1 && n <= 12 ? n : 12;
}

/** The grid classes for a widget's span: "col-span-12 md:col-span-4 xl:col-span-2". */
export function spanClass(span: DashboardWidget['span']): string {
  return [
    BASE[columns(span.base) - 1],
    span.md === undefined ? undefined : MD[columns(span.md) - 1],
    span.xl === undefined ? undefined : XL[columns(span.xl) - 1],
  ]
    .filter((c) => c !== undefined)
    .join(' ');
}

const MD_ROWS = ['md:row-span-1', 'md:row-span-2', 'md:row-span-3', 'md:row-span-4'] as const;
const XL_ROWS = ['xl:row-span-1', 'xl:row-span-2', 'xl:row-span-3', 'xl:row-span-4'] as const;

/** A whole number of rows from 1 to 4 (anything else is one). */
function rowCount(n: number | undefined): number {
  return n !== undefined && Number.isInteger(n) && n >= 1 && n <= 4 ? n : 1;
}

/** The grid classes for a widget's rows: "xl:row-span-3", or nothing for one row. */
export function rowClass(rows: DashboardWidget['rows']): string {
  if (rows === undefined) return '';
  return [
    rows.md === undefined ? undefined : MD_ROWS[rowCount(rows.md) - 1],
    rows.xl === undefined ? undefined : XL_ROWS[rowCount(rows.xl) - 1],
  ]
    .filter((c) => c !== undefined)
    .join(' ');
}

export type Breakpoint = 'base' | 'md' | 'xl';
export const BREAKPOINTS: readonly Breakpoint[] = ['base', 'md', 'xl'];

/** How many columns a span takes from a breakpoint up: an unset one takes the one below it. */
export function columnsAt(span: DashboardWidget['span'], bp: Breakpoint): number {
  const value = bp === 'base' ? span.base : bp === 'md' ? (span.md ?? span.base) : (span.xl ?? span.md ?? span.base);
  return columns(value);
}

/** How many rows a widget spans from a breakpoint up: an unset one takes the one below it. */
export function rowsSpannedAt(w: DashboardWidget, bp: Breakpoint): number {
  return bp === 'base' ? 1 : bp === 'md' ? rowCount(w.rows?.md) : rowCount(w.rows?.xl ?? w.rows?.md);
}

/**
 * The rows the grid lays the widgets out in at a breakpoint, with how many
 * columns each row has filled: each widget goes on the current row if it
 * fits, else starts the next, and a widget spanning several rows keeps its
 * columns taken in the rows below it.
 */
export function placeAt<T extends DashboardWidget>(layout: readonly T[], bp: Breakpoint): { widgets: T[]; filled: number }[] {
  const rows: { widgets: T[]; filled: number }[] = [];
  let carried: { columns: number; rows: number }[] = [];
  const nextRow = (): void => {
    carried = carried.map((c) => ({ ...c, rows: c.rows - 1 })).filter((c) => c.rows > 0);
    rows.push({ widgets: [], filled: carried.reduce((n, c) => n + c.columns, 0) });
  };
  for (const w of layout) {
    const n = columnsAt(w.span, bp);
    const current = rows[rows.length - 1];
    if (current === undefined || current.filled + n > 12) nextRow();
    const row = rows[rows.length - 1];
    if (row === undefined) continue;
    row.widgets.push(w);
    row.filled += n;
    const tall = rowsSpannedAt(w, bp);
    if (tall > 1) carried.push({ columns: n, rows: tall });
  }
  return rows;
}

/** The rows the grid lays the widgets out in at a breakpoint (see placeAt). */
export function rowsAt<T extends DashboardWidget>(layout: readonly T[], bp: Breakpoint): T[][] {
  return placeAt(layout, bp).map((r) => r.widgets);
}

/**
 * The layout without the widgets that have nothing to show (a router with no
 * temperature sensors): at each breakpoint a hidden widget's columns go to
 * the next widget in its row, or the one before it when it ends the row, so
 * the row still fills.
 */
export function withoutHidden<T extends DashboardWidget>(layout: readonly T[], hidden: ReadonlySet<string>): T[] {
  if (!layout.some((w) => hidden.has(w.id))) return [...layout];
  const extra = new Map<string, Record<Breakpoint, number>>();
  for (const bp of BREAKPOINTS) {
    for (const row of rowsAt(layout, bp)) {
      row.forEach((w, i) => {
        if (!hidden.has(w.id)) return;
        const heir =
          row.slice(i + 1).find((x) => !hidden.has(x.id)) ??
          row
            .slice(0, i)
            .reverse()
            .find((x) => !hidden.has(x.id));
        if (heir === undefined) return;
        const e = extra.get(heir.id) ?? { base: 0, md: 0, xl: 0 };
        e[bp] += columnsAt(w.span, bp);
        extra.set(heir.id, e);
      });
    }
  }
  return layout
    .filter((w) => !hidden.has(w.id))
    .map((w) => {
      const e = extra.get(w.id);
      if (e === undefined) return w;
      const at = (bp: Breakpoint): number => Math.min(12, columnsAt(w.span, bp) + e[bp]);
      return { ...w, span: { base: at('base'), md: at('md'), xl: at('xl') } };
    });
}
