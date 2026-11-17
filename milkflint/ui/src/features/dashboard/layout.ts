// Home's layout: which widgets show, in what order, at what size. One model
// for a theme's default, the user's own (kept on the router) and an edit in
// progress: a list in order, each at a size its widget offers; a widget may
// be there more than once. Plain data and small pure functions with no
// React, so the tests run them; the widgets, and the sizes each offers, are
// in widgets.tsx.
import { z } from 'zod';
import type { WidgetSize } from '@/theme/contract';

export type Size = WidgetSize;
export type Width = Size['w'];
export type Height = Size['h'];

/** A widget and its size: what a layout is saved as, and what the grid places. */
export interface Entry<Id extends string = string> {
  readonly id: Id;
  readonly size: Size;
}

export interface Placed<Id extends string = string> extends Entry<Id> {
  /** This one, apart from any other of the same widget: given when a layout comes in, kept through an edit, never saved. */
  readonly key: string;
}
export type Layout<Id extends string = string> = readonly Placed<Id>[];

/** The most widgets Home holds: the router keeps no more (features/dashboard/rpcd.uc). */
export const MAX_WIDGETS = 64;

/** All a layout needs of the widgets: the sizes each offers, its default first. */
export type Catalog<Id extends string> = Readonly<Record<Id, { readonly sizes: readonly [Size, ...Size[]] }>>;

/** "2×1": a size as the interface writes it, columns by rows. */
export function sizeLabel(s: Size): string {
  return `${String(s.w)}×${String(s.h)}`;
}

export function sameSize(a: Size, b: Size): boolean {
  return a.w === b.w && a.h === b.h;
}

/** Of the sizes offered, the one nearest to what was asked for (the earlier one on a tie). */
export function nearestSize(want: { readonly w: number; readonly h: number }, sizes: readonly [Size, ...Size[]]): Size {
  let best = sizes[0];
  let cost = Infinity;
  for (const s of sizes) {
    const c = Math.abs(s.w - want.w) + Math.abs(s.h - want.h);
    if (c < cost) {
      best = s;
      cost = c;
    }
  }
  return best;
}

function isId<Id extends string>(catalog: Catalog<Id>, id: string): id is Id {
  // own keys only: "__proto__", "constructor" and the like are no widget
  return Object.hasOwn(catalog, id);
}

const list = z.array(z.unknown());
const entry = z.object({ id: z.string(), size: z.unknown().optional() });
const size = z.object({ w: z.number(), h: z.number() });

/**
 * The only way a layout comes in, from the router, a theme or anywhere else:
 * unknown widgets left out, a size a widget doesn't offer moved to the
 * nearest it does (a missing one to its default), and never more than Home
 * holds. Never throws: anything else is an empty Home.
 */
export function parseLayout<Id extends string>(raw: unknown, catalog: Catalog<Id>): Layout<Id> {
  const items = list.safeParse(raw);
  if (!items.success) return [];
  const out: Placed<Id>[] = [];
  for (const item of items.data) {
    if (out.length >= MAX_WIDGETS) break;
    const e = entry.safeParse(item);
    if (!e.success || !isId(catalog, e.data.id)) continue;
    const id = e.data.id;
    const sizes = catalog[id].sizes;
    const want = size.safeParse(e.data.size);
    out.push({ key: `w${String(out.length)}`, id, size: want.success ? nearestSize(want.data, sizes) : sizes[0] });
  }
  return out;
}

/** The layout as it's saved: each widget and its size, in order, without the keys an edit keeps. */
export function entries<Id extends string>(layout: Layout<Id>): Entry<Id>[] {
  return layout.map(({ id, size: s }) => ({ id, size: s }));
}

export function sameLayout(a: readonly Entry[], b: readonly Entry[]): boolean {
  return a.length === b.length && a.every((w, i) => w.id === b[i]?.id && sameSize(w.size, b[i].size));
}

/** The layout with the widget at `from` moved to `to` (kept within the list). */
export function moveWidget<T>(layout: readonly T[], from: number, to: number): readonly T[] {
  const moving = layout[from];
  if (moving === undefined) return layout;
  const rest = layout.filter((_, i) => i !== from);
  const at = Math.max(0, Math.min(rest.length, to));
  return [...rest.slice(0, at), moving, ...rest.slice(at)];
}

export function resizeWidget<Id extends string>(layout: Layout<Id>, key: string, size: Size): Layout<Id> {
  return layout.map((w) => (w.key === key ? { ...w, size } : w));
}

/** The widget added at the end (another of it, if it's there already), while Home has room. */
export function addWidget<Id extends string>(layout: Layout<Id>, id: Id, size: Size): Layout<Id> {
  if (layout.length >= MAX_WIDGETS) return layout;
  const used = new Set(layout.map((w) => w.key));
  let n = layout.length;
  while (used.has(`w${String(n)}`)) n++;
  return [...layout, { key: `w${String(n)}`, id, size }];
}

export function removeWidget<Id extends string>(layout: Layout<Id>, key: string): Layout<Id> {
  return layout.filter((w) => w.key !== key);
}

// ---- the grid ----

/**
 * The grid's columns: four where Home's content is wide enough, two at a
 * tablet's width, one on a phone, by a container query on the grid's own
 * width (the side rail changes the room it has). With two or four columns
 * every row is one unit tall, in the theme's spacing (so it follows its
 * density), and never grows: a widget is the size it's given, whatever is
 * beside it, and fits what it shows to that (fit.ts). On a phone each widget
 * is as tall as it needs, with nothing beside it. No dense packing: what's
 * seen, the page's order, the keyboard's and a screen reader's are the same.
 */
export const GRID_CLASS =
  'grid grid-cols-1 gap-4 @2xl/home:grid-cols-2 @2xl/home:auto-rows-[--spacing(60)] @4xl/home:grid-cols-4';
/** The element around the grid, which its container queries measure. */
export const GRID_CONTAINER_CLASS = '@container/home';

// Tailwind writes only the classes it finds in the source, so each is spelt out.
const WIDTH_CLASS = {
  1: '',
  2: '@2xl/home:col-span-2',
  3: '@2xl/home:col-span-2 @4xl/home:col-span-3',
  4: '@2xl/home:col-span-2 @4xl/home:col-span-4',
} as const satisfies Record<Width, string>;
const HEIGHT_CLASS = { 1: '', 2: '@2xl/home:row-span-2' } as const satisfies Record<Height, string>;

/** A widget's grid classes: as many columns as it asks for, or all there are when fewer. */
export function sizeClass(s: Size): string {
  return [WIDTH_CLASS[s.w], HEIGHT_CLASS[s.h]].filter((c) => c !== '').join(' ');
}

export type Columns = 1 | 2 | 4;

/** Where a widget lands: its first column and row (from 0), and the columns and rows it spans. */
export interface Spot<Id extends string = string> {
  readonly id: Id;
  readonly column: number;
  readonly row: number;
  readonly w: number;
  readonly h: number;
}

/**
 * Where the grid puts each widget at a number of columns, as CSS grid's
 * auto-placement does without dense packing: in order, each at the first
 * place from the one before it on where it fits, never back into a gap
 * behind it. The grid does this itself; this says what it will do, for a
 * drag over a gap (dropIndex) and the tests.
 */
export function place<Id extends string>(layout: readonly Entry<Id>[], columns: Columns): Spot<Id>[] {
  const taken = new Set<string>();
  const free = (row: number, column: number, w: number, h: number): boolean => {
    for (let r = row; r < row + h; r++)
      for (let c = column; c < column + w; c++) if (taken.has(`${String(r)},${String(c)}`)) return false;
    return true;
  };
  const spots: Spot<Id>[] = [];
  let row = 0;
  let column = 0;
  for (const { id, size: s } of layout) {
    const w = Math.min(s.w, columns);
    const h = s.h;
    for (;;) {
      if (column + w > columns) {
        row++;
        column = 0;
      } else if (free(row, column, w, h)) break;
      else column++;
    }
    for (let r = row; r < row + h; r++) for (let c = column; c < column + w; c++) taken.add(`${String(r)},${String(c)}`);
    spots.push({ id, column, row, w, h });
    column += w;
  }
  return spots;
}

/** A cell of the grid: its row and column, from 0. */
export interface Cell {
  readonly row: number;
  readonly column: number;
}

/** The widget on a cell, if any. */
export function covering<Id extends string>(spots: readonly Spot<Id>[], cell: Cell): Spot<Id> | undefined {
  return spots.find(
    (s) => cell.row >= s.row && cell.row < s.row + s.h && cell.column >= s.column && cell.column < s.column + s.w,
  );
}

/** The cells the widgets leave empty, row by row, up to the last row they reach. */
export function gaps(spots: readonly Spot[], columns: Columns): Cell[] {
  const rows = Math.max(0, ...spots.map((s) => s.row + s.h));
  const out: Cell[] = [];
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      if (covering(spots, { row, column }) === undefined) out.push({ row, column });
    }
  }
  return out;
}

/**
 * Where in the order the widget at `from` has to go to land on a cell (a gap
 * it's dragged over): of the places that put it on the cell, one with its
 * corner there if there is one, then the nearest to where it is. Undefined
 * when no place in the order puts it there (a gap narrower than it).
 */
export function dropIndex(layout: readonly Entry[], from: number, cell: Cell, columns: Columns): number | undefined {
  let best: number | undefined;
  let cost = Infinity;
  for (let to = 0; to < layout.length; to++) {
    const spot = place(moveWidget(layout, from, to), columns)[to];
    if (spot === undefined || covering([spot], cell) === undefined) continue;
    const c = (spot.row === cell.row && spot.column === cell.column ? 0 : layout.length) + Math.abs(to - from);
    if (c < cost) {
      best = to;
      cost = c;
    }
  }
  return best;
}
