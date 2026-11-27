// Every table in the UI, on TanStack Table: a table when its own box is wide
// (a container query), a card per row when narrow, so a widget and a page
// draw the very same list. A column with a `sort` value sorts from its
// heading (aria-sort): a first click in its own first direction, a second
// turns it round, and a third goes back to the order the rows came in,
// unless the table has an initial sort, which then only turns round. In the
// card layout a Sort menu and a Reverse button stand in for the headings.
// Groups (a heading row each, as the firewall's chains) keep their order and
// don't sort, and nor does a compact table (a Home widget, whose rows drop
// from the end when short of room). `limit` cuts a widget's list; `pageSize`
// draws that many rows and a Show more button.
import {
  createSortedRowModel,
  type RowData,
  rowSortingFeature,
  type SortFn,
  type SortingState,
  tableFeatures,
  useTable,
} from '@tanstack/react-table';
import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon } from 'lucide-react';
import { type ComponentProps, Fragment, type ReactElement, type ReactNode, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

export interface Column<T> {
  /** The heading's text, unique among the table's columns: the column's name in cards, the Sort menu and tests. */
  label: string;
  /** A heading richer than its label (an icon, a tooltip); the label otherwise. */
  header?: ReactNode;
  cell: (row: T) => ReactNode;
  /** What the column sorts by; without it the column doesn't sort. Undefined sorts last either way. */
  sort?: ((row: T) => string | number | undefined) | undefined;
  /** Sorts largest (or latest) first on the first click, as numbers usually should. */
  sortDescFirst?: boolean | undefined;
  /** The column in the card layout's Sort menu ("Most sent first"); its label otherwise. */
  sortLabel?: string | undefined;
  className?: string | undefined;
  /** A tooltip on the heading. */
  title?: string | undefined;
  /** Heading only for screen readers; a card leaves out its label too. */
  hidden?: boolean | undefined;
  /** Kept when the table is compact (a Home widget). */
  compact?: boolean | undefined;
}

export interface Group<T> {
  key: string;
  /** The group's heading row: its title, count and action. */
  header: ReactNode;
  rows: readonly T[];
  /** Shown in the group when it has no rows; without it an empty group shows only its heading. */
  empty?: ReactNode;
}

/** How wide the table's own box must be for a table rather than cards. Whole class names, so Tailwind sees them. */
const WIDE = {
  sm: { table: 'hidden @min-[40rem]:block', cards: '@min-[40rem]:hidden' },
  md: { table: 'hidden @min-[48rem]:block', cards: '@min-[48rem]:hidden' },
  lg: { table: 'hidden @min-[60rem]:block', cards: '@min-[60rem]:hidden' },
} as const;

const features = tableFeatures({ rowSortingFeature, sortedRowModel: createSortedRowModel() });
const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
/** Numbers as numbers; text as people read it, with the numbers in it as numbers (192.168.1.3 before 192.168.1.20). */
function compareFor<T extends RowData>(): SortFn<typeof features, T> {
  return (a, b, id) => {
    const x = a.getValue<string | number>(id);
    const y = b.getValue<string | number>(id);
    return typeof x === 'number' && typeof y === 'number' ? x - y : collator.compare(String(x), String(y));
  };
}

const groupRow = 'border-y bg-muted/60 px-3 py-1.5 text-left font-normal';
// the Sort menu's value for the order the rows came in (Radix refuses an empty one)
const AS_LISTED = '-';

export function DataTable<T extends RowData>({
  label,
  columns,
  rows,
  groups,
  rowKey,
  empty,
  initialSort,
  defaultOrder = 'As listed',
  limit,
  pageSize,
  compact = false,
  fit = false,
  framed = true,
  inset = false,
  wide = 'sm',
  cards = true,
  card,
  rowProps,
  detail,
  stickyHeader = false,
  className,
}: {
  label: string;
  columns: readonly Column<T>[];
  rows?: readonly T[] | undefined;
  /** Rows in groups, each with its heading row; nothing sorts then. */
  groups?: readonly Group<T>[] | undefined;
  rowKey: (row: T) => string;
  /** Shown instead of the table when there are no rows (and no groups). */
  empty: ReactNode;
  /** A sort to start with (a column's label, and which way): the headings then only turn it round. */
  initialSort?: { id: string; desc: boolean } | undefined;
  /** The Sort menu's name for the order the rows came in. */
  defaultOrder?: string;
  /** At most this many rows, cut silently (a widget). */
  limit?: number | undefined;
  /** This many rows at a time, with a Show more button. */
  pageSize?: number | undefined;
  compact?: boolean | undefined;
  /** Mark each row `data-fit`, so a widget short of room drops the last rows first (dashboard/fit.ts). */
  fit?: boolean | undefined;
  /** In a card of its own (false when the table already sits in one). */
  framed?: boolean | undefined;
  /** Unframed, edge to edge down to a card's foot: the Sort menu and Show more keep to the card's padding. */
  inset?: boolean | undefined;
  wide?: keyof typeof WIDE | undefined;
  /** False: always a table (it scrolls sideways when narrow). */
  cards?: boolean | undefined;
  /** A row's card, when the default (its first column as the title, then "Label: value" lines) doesn't fit. */
  card?: ((row: T) => ReactNode) | undefined;
  /** A table row's own props: a click to open it, its look when off, selection. */
  rowProps?: ((row: T) => ComponentProps<'tr'>) | undefined;
  /** A full-width row under a row (an opened process's details, an error), when it returns something. */
  detail?: ((row: T) => ReactNode) | undefined;
  /**
   * The headings stay put while the box around the table scrolls. The table
   * then doesn't scroll sideways itself, and wants framed={false}: a box of
   * its own that scrolls or clips (a frame) would hold them.
   */
  stickyHeader?: boolean | undefined;
  className?: string | undefined;
}): ReactElement {
  const cols = useMemo(() => (compact ? columns.filter((c) => c.compact === true) : columns), [columns, compact]);
  const grouped = groups !== undefined;
  const sorts = !grouped && !compact;
  // pass stable columns (a module constant, or memoized): TanStack's follow them
  const tsColumns = useMemo(
    () =>
      cols.map((c) => ({
        id: c.label,
        accessorFn: (r: T) => c.sort?.(r),
        enableSorting: c.sort !== undefined && sorts,
        sortDescFirst: c.sortDescFirst === true,
        sortUndefined: 'last' as const,
        sortFn: compareFor<T>(),
      })),
    [cols, sorts],
  );
  const data = useMemo(() => (groups === undefined ? [...(rows ?? [])] : groups.flatMap((g) => g.rows)), [rows, groups]);
  const [sorting, setSorting] = useState<SortingState>(initialSort === undefined ? [] : [initialSort]);
  const [shownCount, setShownCount] = useState(pageSize);
  const table = useTable({
    features,
    columns: tsColumns,
    data,
    state: { sorting },
    onSortingChange: setSorting,
    getRowId: (r) => rowKey(r),
    enableSortingRemoval: initialSort === undefined,
  });

  const sorted = table.getRowModel().rows.map((r) => r.original);
  const cap = limit ?? shownCount;
  const shown = cap === undefined ? sorted : sorted.slice(0, cap);
  const sortable = sorts ? cols.filter((c) => c.sort !== undefined) : [];
  const active = sorting[0];

  if (data.length === 0 && (groups === undefined || groups.length === 0)) {
    return <p className="px-4 py-6 text-sm text-muted-foreground">{empty}</p>;
  }

  const fitProp = fit ? { 'data-fit': '' } : {};
  // a sticky heading needs separate borders, which rows don't draw: their cells draw the lines then
  const line = stickyHeader ? '[&>td]:border-b last:[&>td]:border-b-0' : 'border-b last:border-b-0';
  const scroll = stickyHeader ? undefined : 'overflow-x-auto';
  const pad = (i: number): string | false => (i === 0 ? 'pl-5' : i === cols.length - 1 && 'pr-5');
  const bodyRows = (list: readonly T[]): ReactNode =>
    list.map((r) => {
      const key = rowKey(r);
      const props = rowProps?.(r) ?? {};
      const more = detail?.(r);
      return (
        <Fragment key={key}>
          <tr {...fitProp} {...props} className={cn(line, 'transition-colors duration-fast hover:bg-muted/60', props.className)}>
            {cols.map((c, i) => (
              <td key={c.label} className={cn('px-3 py-2.5 align-middle', pad(i), c.className)}>
                {c.cell(r)}
              </td>
            ))}
          </tr>
          {more !== undefined && more !== null && more !== false && (
            <tr className={line}>
              <td colSpan={cols.length} className="px-5 py-2.5">
                {more}
              </td>
            </tr>
          )}
        </Fragment>
      );
    });

  const tableView = (
    <table
      aria-label={label}
      className={cn('w-full text-sm', stickyHeader ? 'border-separate border-spacing-0' : 'border-collapse')}
    >
      <thead className={stickyHeader ? undefined : 'border-b'}>
        <tr className="text-left text-xs text-muted-foreground">
          {cols.map((c, i) => {
            const col = sorts ? table.getColumn(c.label) : undefined;
            const dir = col?.getIsSorted() ?? false;
            const Arrow = dir === 'desc' ? ArrowDownIcon : ArrowUpIcon;
            return (
              <th
                key={c.label}
                scope="col"
                title={c.title}
                aria-sort={dir === 'desc' ? 'descending' : dir === 'asc' ? 'ascending' : undefined}
                className={cn(
                  'h-9 px-3 font-medium whitespace-nowrap',
                  stickyHeader && 'sticky top-0 z-10 border-b bg-popover',
                  pad(i),
                  c.className,
                )}
              >
                {c.hidden === true ? (
                  <span className="sr-only">{c.label}</span>
                ) : col?.getCanSort() === true ? (
                  <button
                    type="button"
                    onClick={col.getToggleSortingHandler()}
                    className={cn(
                      'inline-flex min-h-6 cursor-pointer items-center gap-1 rounded-sm hover:text-foreground',
                      dir !== false && 'text-foreground',
                    )}
                  >
                    {c.header ?? c.label}
                    {dir !== false && <Arrow className="size-3" aria-hidden />}
                  </button>
                ) : (
                  (c.header ?? c.label)
                )}
              </th>
            );
          })}
        </tr>
      </thead>
      {groups === undefined ? (
        <tbody>{bodyRows(shown)}</tbody>
      ) : (
        groups.map((g) => (
          <tbody key={g.key}>
            <tr>
              <th scope="colgroup" colSpan={cols.length} className={groupRow}>
                {g.header}
              </th>
            </tr>
            {g.rows.length === 0 && g.empty !== undefined ? (
              <tr>
                <td colSpan={cols.length} className="px-5 py-4 text-sm text-muted-foreground">
                  {g.empty}
                </td>
              </tr>
            ) : (
              bodyRows(g.rows)
            )}
          </tbody>
        ))
      )}
    </table>
  );

  const cardOf = (r: T): ReactNode => {
    if (card !== undefined) return card(r);
    const [title, ...rest] = cols;
    return (
      <>
        {title !== undefined && <span className="min-w-0 font-medium break-words">{title.cell(r)}</span>}
        {rest.map((c) => {
          const value = c.cell(r);
          // an empty cell is no line (a flag that's off)
          return value === '' || value === null || value === undefined || value === false ? null : (
            <span key={c.label} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
              {c.hidden === true ? null : <span className="text-xs text-muted-foreground">{c.label}:</span>}
              <span className="min-w-0 break-all">{value}</span>
            </span>
          );
        })}
      </>
    );
  };
  const cardItems = (list: readonly T[]): ReactNode =>
    list.map((r) => (
      <li key={rowKey(r)} {...fitProp} className={cn(card === undefined && 'flex flex-col gap-1.5 px-4 py-3 text-sm')}>
        {cardOf(r)}
      </li>
    ));
  const cardList = (list: readonly T[], name: string): ReactNode => (
    // Safari drops a list's role when its markers are off, so say it
    // eslint-disable-next-line jsx-a11y/no-redundant-roles
    <ul role="list" aria-label={name} className="divide-y">
      {cardItems(list)}
    </ul>
  );
  const cardView =
    groups === undefined
      ? cardList(shown, label)
      : groups.map((g) => (
          <section key={g.key} aria-label={`${label}: ${g.key}`}>
            <div className={groupRow}>{g.header}</div>
            {g.rows.length === 0 && g.empty !== undefined ? (
              <p className="px-4 py-3 text-sm text-muted-foreground">{g.empty}</p>
            ) : (
              cardList(g.rows, `${label}: ${g.key}`)
            )}
          </section>
        ));

  const frame = (child: ReactNode): ReactNode => (framed ? <Card className="gap-0 overflow-hidden py-0">{child}</Card> : child);
  const sortMenu = cards && sortable.length > 0 && (
    <div className={cn('flex items-center gap-2', inset && 'px-5', WIDE[wide].cards)}>
      <Select
        value={active?.id ?? AS_LISTED}
        onValueChange={(v) => {
          const c = sortable.find((x) => x.label === v);
          setSorting(c === undefined ? [] : [{ id: c.label, desc: c.sortDescFirst === true }]);
        }}
      >
        <SelectTrigger aria-label="Sort" className="w-56">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {initialSort === undefined && <SelectItem value={AS_LISTED}>{defaultOrder}</SelectItem>}
          {sortable.map((c) => (
            <SelectItem key={c.label} value={c.label}>
              {c.sortLabel ?? c.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {active !== undefined && (
        <Button
          variant="outline"
          size="icon"
          aria-label="Reverse the order"
          aria-pressed={active.desc !== (sortable.find((c) => c.label === active.id)?.sortDescFirst === true)}
          onClick={() => {
            setSorting([{ id: active.id, desc: !active.desc }]);
          }}
        >
          <ArrowUpDownIcon />
        </Button>
      )}
    </div>
  );

  return (
    <div className={cn('@container flex flex-col gap-3', className)}>
      {sortMenu}
      {cards
        ? frame(
            <>
              <div className={cn(WIDE[wide].table, scroll)}>{tableView}</div>
              <div className={WIDE[wide].cards}>{cardView}</div>
            </>,
          )
        : frame(<div className={scroll}>{tableView}</div>)}
      {limit === undefined && shownCount !== undefined && sorted.length > shown.length && (
        <div className={cn('flex flex-wrap items-center gap-3 text-sm text-muted-foreground', inset && 'px-5 pb-4')}>
          <span>
            Showing {shown.length.toLocaleString('en-GB')} of {sorted.length.toLocaleString('en-GB')}.
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setShownCount(shownCount + (pageSize ?? 0));
            }}
          >
            Show {Math.min(pageSize ?? 0, sorted.length - shown.length).toLocaleString('en-GB')} more
          </Button>
        </div>
      )}
    </div>
  );
}
