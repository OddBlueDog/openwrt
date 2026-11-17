// Home's grid of widgets (layout.ts places them), and its edit mode: a bar
// along each widget's foot with a drag handle, its size, move earlier and
// later, and Remove, while its content stays live but inert (and the size it
// is, so editing doesn't move anything).
//
// Dragging is Pointer Events from the handle only (mouse, touch and pen;
// the handle alone has touch-action: none, so a phone still scrolls): the
// widget follows the pointer, its cell stays behind as the place it will
// land, the others move aside on the theme's durations, and the page scrolls
// near its edges. Over another widget it takes that one's place; over a gap,
// the place in the order that lands it there (layout.ts, dropIndex); below
// the last row, the end. Without a pointer, the handle works from the
// keyboard: Space or Enter picks the widget up, the arrow keys move it, Space
// drops it and Escape puts it back, each step said in a polite live region.
import { ArrowLeftIcon, ArrowRightIcon, GripVerticalIcon, XIcon } from 'lucide-react';
import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
  type Columns,
  covering,
  dropIndex,
  GRID_CLASS,
  GRID_CONTAINER_CLASS,
  type Layout,
  place,
  type Size,
  sameSize,
  sizeClass,
  sizeLabel,
} from './layout';
import { Widget } from './widget';
import { WidgetInfoContext } from './widget-info';
import { definition, type HomeData, type WidgetId } from './widgets';

/** What an edit can do to the layout (each widget by its key: one may be there twice); Home's page holds the draft. */
export interface Editing {
  move: (from: number, to: number) => void;
  resize: (key: string, size: Size) => void;
  remove: (key: string) => void;
  /** Says a step in the page's polite live region. */
  announce: (text: string) => void;
}

/** The pointer moves this far before a press on the handle becomes a drag. */
const DRAG_SLOP_PX = 4;
/** How near the window's top or bottom edge the page scrolls while dragging. */
const EDGE_PX = 56;

/** A motion token's length in ms (0 under reduced motion, where the theme's CSS sets them to 0). */
function motionMs(name: 'fast' | 'base' | 'slow'): number {
  const v = getComputedStyle(document.documentElement).getPropertyValue(`--mf-duration-${name}`).trim();
  const n = Number.parseFloat(v);
  if (!Number.isFinite(n)) return 0;
  return v.endsWith('ms') ? n : v.endsWith('s') ? n * 1000 : n;
}
function easing(): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--mf-ease-standard').trim();
  return v === '' ? 'ease' : v;
}

/** A cell, and what's in it: exactly the cell's size, however much its widget has to show (it fits that to the cell). */
const FILL = 'grid min-w-0 grid-rows-[minmax(0,1fr)]';

/** Each widget's name while editing: its title, numbered where it's on Home more than once ("CPU 2"), by key. */
function namesOf(layout: Layout<WidgetId>): Map<string, string> {
  const count = new Map<WidgetId, number>();
  for (const w of layout) count.set(w.id, (count.get(w.id) ?? 0) + 1);
  const seen = new Map<WidgetId, number>();
  const out = new Map<string, string>();
  for (const w of layout) {
    const title = definition(w.id).title;
    const nth = (seen.get(w.id) ?? 0) + 1;
    seen.set(w.id, nth);
    out.set(w.key, (count.get(w.id) ?? 1) > 1 ? `${title} ${String(nth)}` : title);
  }
  return out;
}

const position = (title: string, i: number, n: number): string => `${title}, position ${String(i + 1)} of ${String(n)}`;

/** Which of a grid's tracks an offset from its start is in (undefined in a gap between them, or past the last). */
function track(sizes: readonly number[], gap: number, offset: number): number | undefined {
  let start = 0;
  for (const [i, size] of sizes.entries()) {
    if (offset < start) return undefined;
    if (offset < start + size) return i;
    start += size + gap;
  }
  return undefined;
}

/** The grid's track sizes in px, as the browser resolved them (implicit rows too). */
function tracks(value: string): number[] {
  return value
    .split(' ')
    .map((v) => Number.parseFloat(v))
    .filter((v) => Number.isFinite(v));
}

interface Parts {
  /** The grid item: the place the widget holds (a dashed outline while it's lifted). */
  cell: HTMLElement;
  /** What moves: the edit bar and the widget. */
  lift: HTMLElement;
}

interface Drag {
  key: string;
  /** its name, for what the live region says */
  title: string;
  pointerId: number;
  from: number;
  x: number;
  y: number;
  /** where on the widget it was picked up */
  dx: number;
  dy: number;
  moved: boolean;
  /** the widget it last swapped with: not again until the pointer has left it */
  swapped: string | undefined;
  /** stops following the pointer (window listeners: a move re-inserts the widget's node, which drops a pointer capture) */
  detach: () => void;
}

export function HomeGrid({
  layout,
  data,
  editing,
}: {
  layout: Layout<WidgetId>;
  data: HomeData;
  editing?: Editing | undefined;
}): ReactElement {
  // widgets with nothing to show on this router are left out, except while editing, where they say so
  const shown = useMemo(
    () => (editing === undefined ? layout.filter((w) => definition(w.id).hidden?.(data) !== true) : layout),
    [layout, data, editing],
  );
  // each widget by its key
  const parts = useRef(new Map<string, Parts>());
  // one ref callback for every cell, the same on every redraw (a new one each time would drop and re-add its parts):
  // the cell says whose it is, and its cleanup takes it out
  const register = useCallback((cell: HTMLDivElement) => {
    const key = cell.dataset['key'];
    const lift = cell.firstElementChild;
    if (key === undefined || !(lift instanceof HTMLElement)) return;
    parts.current.set(key, { cell, lift });
    return () => {
      if (parts.current.get(key)?.cell === cell) parts.current.delete(key);
    };
  }, []);
  const names = useMemo(() => namesOf(shown), [shown]);
  const grid = useRef<HTMLDivElement>(null);
  // the layout and order as drawn, for the pointer's handlers (set once it's drawn, below)
  const drawnLayout = useRef<Layout<WidgetId>>([]);
  const order = useRef<readonly string[]>([]);
  const drag = useRef<Drag | undefined>(undefined);
  const [dragging, setDragging] = useState<string>();
  const [lifted, setLifted] = useState<{ key: string; from: number }>();
  /** the control to focus once a move or removal has been drawn */
  const refocus = useRef<{ key: string; control: string } | undefined>(undefined);
  const hint = useId();

  const announce = useCallback(
    (text: string) => {
      editing?.announce(text);
    },
    [editing],
  );

  const move = useCallback(
    (from: number, to: number) => {
      if (from !== to) editing?.move(from, to);
    },
    [editing],
  );

  // ---- the lifted widget follows the pointer ----

  const follow = useCallback(() => {
    const d = drag.current;
    const p = d === undefined ? undefined : parts.current.get(d.key);
    if (d?.moved !== true || p === undefined) return;
    const cell = p.cell.getBoundingClientRect();
    p.lift.style.transform = `translate(${String(d.x - d.dx - cell.left)}px, ${String(d.y - d.dy - cell.top)}px)`;
  }, []);

  // over no widget: a gap's place in the order, or the end below the last row (undefined: stay)
  const gapTarget = useCallback((x: number, y: number, at: number): number | undefined => {
    const g = grid.current;
    if (g === null) return undefined;
    const r = g.getBoundingClientRect();
    if (x < r.left || x > r.right || y < r.top) return undefined;
    const layout = drawnLayout.current;
    if (y > r.bottom) return layout.length - 1;
    const style = getComputedStyle(g);
    const cols = tracks(style.gridTemplateColumns);
    const columns: Columns = cols.length >= 4 ? 4 : cols.length === 2 ? 2 : 1;
    if (columns === 1) return undefined;
    const column = track(cols, Number.parseFloat(style.columnGap), x - r.left);
    const row = track(tracks(style.gridTemplateRows), Number.parseFloat(style.rowGap), y - r.top);
    if (column === undefined || row === undefined) return undefined;
    // on a widget's own cell (the one being dragged, or the gutter's edge): nothing to do
    if (covering(place(layout, columns), { row, column }) !== undefined) return undefined;
    return dropIndex(layout, at, { row, column }, columns);
  }, []);

  // over another widget: take its place (once, until the pointer leaves it, so two of different sizes don't
  // swap back and forth); over a gap: go where it lands there
  const retarget = useCallback(() => {
    const d = drag.current;
    if (d?.moved !== true) return;
    const at = order.current.indexOf(d.key);
    for (const [key, p] of parts.current) {
      if (key === d.key) continue;
      const r = p.cell.getBoundingClientRect();
      const over = d.x >= r.left && d.x <= r.right && d.y >= r.top && d.y <= r.bottom;
      if (!over) {
        if (d.swapped === key) d.swapped = undefined;
        continue;
      }
      if (d.swapped === key) return;
      d.swapped = key;
      move(at, order.current.indexOf(key));
      return;
    }
    const own = parts.current.get(d.key)?.cell.getBoundingClientRect();
    if (own !== undefined && d.x >= own.left && d.x <= own.right && d.y >= own.top && d.y <= own.bottom) return;
    const to = gapTarget(d.x, d.y, at);
    if (to !== undefined && to !== at) move(at, to);
  }, [gapTarget, move]);

  // the page scrolls while the pointer is near the window's top or bottom
  useEffect(() => {
    if (dragging === undefined) return;
    let frame = 0;
    const tick = (): void => {
      const d = drag.current;
      if (d?.moved === true) {
        const v =
          d.y < EDGE_PX
            ? -(EDGE_PX - d.y) / 4
            : d.y > window.innerHeight - EDGE_PX
              ? (d.y - window.innerHeight + EDGE_PX) / 4
              : 0;
        if (v !== 0) {
          window.scrollBy(0, Math.round(v));
          follow();
          retarget();
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [dragging, follow, retarget]);

  const settle = useCallback((key: string) => {
    const p = parts.current.get(key);
    if (p === undefined) return;
    const from = p.lift.style.transform;
    p.lift.style.transform = '';
    const ms = motionMs('base');
    if (from !== '' && ms > 0) p.lift.animate([{ transform: from }, { transform: 'none' }], { duration: ms, easing: easing() });
  }, []);

  const endDrag = useCallback(
    (cancel: boolean) => {
      const d = drag.current;
      drag.current = undefined;
      d?.detach();
      if (d?.moved !== true) return;
      const n = order.current.length;
      if (cancel) {
        move(order.current.indexOf(d.key), d.from);
        announce(`Move cancelled. ${position(d.title, d.from, n)}.`);
      } else announce(`${position(d.title, order.current.indexOf(d.key), n)}.`);
      setDragging(undefined);
      settle(d.key);
    },
    [announce, move, settle],
  );

  // leaving Home mid-drag: stop following the pointer
  useEffect(
    () => () => {
      drag.current?.detach();
    },
    [],
  );

  // Escape puts a dragged widget back
  useEffect(() => {
    if (dragging === undefined) return;
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        endDrag(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [dragging, endDrag]);

  // ---- the others move aside on the theme's durations ----

  const positions = useRef(new Map<string, { x: number; y: number }>());
  const drawn = useRef(layout);
  useLayoutEffect(() => {
    drawnLayout.current = shown;
    order.current = shown.map((w) => w.key);
  });

  useLayoutEffect(() => {
    const changed = drawn.current !== layout;
    drawn.current = layout;
    const now = new Map<string, { x: number; y: number }>();
    // offsetLeft and offsetTop leave transforms out: where the grid put each one
    for (const [key, p] of parts.current) now.set(key, { x: p.cell.offsetLeft, y: p.cell.offsetTop });
    const ms = changed ? motionMs('base') : 0;
    if (ms > 0) {
      for (const [key, at] of now) {
        const was = positions.current.get(key);
        const p = parts.current.get(key);
        if (was === undefined || p === undefined || key === drag.current?.key) continue;
        const dx = was.x - at.x;
        const dy = was.y - at.y;
        if (dx !== 0 || dy !== 0)
          p.lift.animate([{ transform: `translate(${String(dx)}px, ${String(dy)}px)` }, { transform: 'none' }], {
            duration: ms,
            easing: easing(),
          });
      }
    }
    positions.current = now;
    follow();
    const r = refocus.current;
    if (r !== undefined) {
      refocus.current = undefined;
      const cell = parts.current.get(r.key)?.cell;
      const want = cell?.querySelector<HTMLButtonElement>(`[data-control="${r.control}"]`);
      const handle = cell?.querySelector<HTMLButtonElement>('[data-control="handle"]');
      (want !== undefined && want !== null && !want.disabled ? want : handle)?.focus();
    }
  });

  if (editing === undefined) {
    return (
      <div className={GRID_CONTAINER_CLASS}>
        <div className={GRID_CLASS}>
          {shown.map((w) => (
            <div key={w.key} className={cn(FILL, sizeClass(w.size))}>
              <Slot id={w.id} size={w.size} data={data} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const n = shown.length;
  const handlers = (key: string, title: string, i: number) => {
    return {
      onPointerDown: (e: PointerEvent<HTMLButtonElement>) => {
        if (e.button !== 0) return;
        const p = parts.current.get(key);
        if (p === undefined) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        const r = p.lift.getBoundingClientRect();
        setLifted(undefined);
        // followed on the window, not the handle: when the widget moves in the order its node is re-inserted,
        // which drops the handle's pointer capture, and the rest of the drag would go elsewhere
        const onMove = (ev: globalThis.PointerEvent): void => {
          const d = drag.current;
          if (d?.pointerId !== ev.pointerId) return;
          d.x = ev.clientX;
          d.y = ev.clientY;
          if (!d.moved) {
            const at = parts.current.get(d.key);
            if (at === undefined) return;
            const box = at.lift.getBoundingClientRect();
            if (Math.hypot(d.x - (box.left + d.dx), d.y - (box.top + d.dy)) < DRAG_SLOP_PX) return;
            d.moved = true;
            setDragging(d.key);
            announce(`${position(title, d.from, n)}, picked up.`);
          }
          follow();
          retarget();
        };
        const onUp = (ev: globalThis.PointerEvent): void => {
          if (drag.current?.pointerId === ev.pointerId) endDrag(false);
        };
        const onCancel = (ev: globalThis.PointerEvent): void => {
          if (drag.current?.pointerId === ev.pointerId) endDrag(true);
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onCancel);
        drag.current?.detach();
        drag.current = {
          key,
          title,
          pointerId: e.pointerId,
          from: i,
          x: e.clientX,
          y: e.clientY,
          dx: e.clientX - r.left,
          dy: e.clientY - r.top,
          moved: false,
          swapped: undefined,
          detach: () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            window.removeEventListener('pointercancel', onCancel);
          },
        };
      },
      onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => {
        const pick = e.key === ' ' || e.key === 'Enter';
        if (lifted?.key !== key) {
          if (!pick) return;
          e.preventDefault();
          setLifted({ key, from: i });
          announce(
            `${position(title, i, n)}, picked up. The arrow keys move it, Space drops it, Escape puts it back where it was.`,
          );
          return;
        }
        const earlier = e.key === 'ArrowLeft' || e.key === 'ArrowUp';
        const later = e.key === 'ArrowRight' || e.key === 'ArrowDown';
        if (earlier || later) {
          e.preventDefault();
          const to = Math.max(0, Math.min(n - 1, i + (earlier ? -1 : 1)));
          if (to === i) {
            announce(`${position(title, i, n)}: ${earlier ? 'already first' : 'already last'}.`);
            return;
          }
          refocus.current = { key, control: 'handle' };
          move(i, to);
          announce(`${position(title, to, n)}.`);
        } else if (pick) {
          e.preventDefault();
          setLifted(undefined);
          announce(`${position(title, i, n)}, dropped.`);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          refocus.current = { key, control: 'handle' };
          move(i, lifted.from);
          setLifted(undefined);
          announce(`Move cancelled. ${position(title, lifted.from, n)}.`);
        }
      },
      onBlur: () => {
        // a move redraws it and gives focus back; leaving it any other way drops it where it is
        if (refocus.current === undefined && lifted?.key === key) setLifted(undefined);
      },
    };
  };

  return (
    <div className={GRID_CONTAINER_CLASS}>
      <p id={hint} className="sr-only">
        Space or Enter picks the widget up, the arrow keys move it, Space drops it, Escape puts it back.
      </p>
      <div ref={grid} className={cn(GRID_CLASS, 'relative')}>
        {shown.map((w, i) => {
          const def = definition(w.id);
          const name = names.get(w.key) ?? def.title;
          const nothing = def.hidden?.(data) === true;
          const isDragged = dragging === w.key;
          return (
            <div
              key={w.key}
              ref={register}
              data-widget={w.id}
              data-key={w.key}
              className={cn(
                FILL,
                'rounded-xl',
                sizeClass(w.size),
                isDragged && 'bg-muted/40 outline-2 outline-offset-2 outline-rule outline-dashed',
              )}
            >
              {/* the bar lies over the widget's foot, so the widget is the size it is on Home, its top in view */}
              <div className={cn(FILL, 'relative rounded-xl', isDragged && 'z-20 cursor-grabbing shadow-lg')}>
                <EditBar
                  id={w.id}
                  name={name}
                  size={w.size}
                  first={i === 0}
                  last={i === n - 1}
                  lifted={lifted?.key === w.key || isDragged}
                  hint={hint}
                  handle={handlers(w.key, name, i)}
                  onMove={(dir) => {
                    const to = i + (dir === 'earlier' ? -1 : 1);
                    refocus.current = { key: w.key, control: dir };
                    move(i, to);
                    announce(`${position(name, to, n)}.`);
                  }}
                  onResize={(s) => {
                    editing.resize(w.key, s);
                    announce(`${name}, ${sizeLabel(s)}.`);
                  }}
                  onRemove={() => {
                    const next = shown[i + 1] ?? shown[i - 1];
                    if (next !== undefined) refocus.current = { key: next.key, control: 'handle' };
                    editing.remove(w.key);
                    announce(`${name} removed.`);
                    if (next === undefined) document.querySelector<HTMLButtonElement>('[data-home-add]')?.focus();
                  }}
                />
                {/* live, but its links and buttons don't fire while Home is being edited */}
                <div inert className={FILL}>
                  <Slot id={w.id} size={w.size} data={data} nothing={nothing} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Slot({
  id,
  size,
  data,
  nothing = false,
}: {
  id: WidgetId;
  size: Size;
  data: HomeData;
  nothing?: boolean;
}): ReactElement {
  const def = definition(id);
  const info = useMemo(() => ({ title: def.title, icon: def.icon, size }), [def, size]);
  const Render = def.render;
  return (
    <WidgetInfoContext.Provider value={info}>
      {nothing ? (
        <Widget>
          <p className="px-5 text-sm text-muted-foreground">Nothing to show on this router.</p>
        </Widget>
      ) : (
        <Render {...data} size={size} />
      )}
    </WidgetInfoContext.Provider>
  );
}

function EditBar({
  id,
  name: title,
  size,
  first,
  last,
  lifted,
  hint,
  handle,
  onMove,
  onResize,
  onRemove,
}: {
  id: WidgetId;
  /** its title, numbered where the widget is on Home more than once */
  name: string;
  size: Size;
  first: boolean;
  last: boolean;
  lifted: boolean;
  hint: string;
  handle: {
    onPointerDown: (e: PointerEvent<HTMLButtonElement>) => void;
    onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void;
    onBlur: () => void;
  };
  onMove: (dir: 'earlier' | 'later') => void;
  onResize: (size: Size) => void;
  onRemove: () => void;
}): ReactElement {
  const { sizes } = definition(id);
  return (
    // one row at the widget's foot, on a quieter see-through ground: the widget's title, figure and details stay in
    // view while it's edited (its name is the card's own; the controls' labels carry it, numbered when repeated)
    <div className="absolute inset-x-2 bottom-2 z-10 flex items-center gap-0.5 rounded-lg border bg-muted/90 p-1 shadow-sm">
      <button
        type="button"
        data-control="handle"
        aria-label={`Move ${title}`}
        aria-describedby={hint}
        aria-pressed={lifted}
        title="Drag to move, or press Space and use the arrow keys"
        className="flex size-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground transition-colors duration-fast hover:bg-accent hover:text-foreground active:cursor-grabbing aria-pressed:bg-primary-subtle aria-pressed:text-primary-subtle-foreground"
        {...handle}
      >
        <GripVerticalIcon className="size-4" aria-hidden="true" />
      </button>
      {sizes.length > 1 ? (
        <Select
          value={sizeLabel(size)}
          onValueChange={(v) => {
            const s = sizes.find((x) => sizeLabel(x) === v);
            if (s !== undefined && !sameSize(s, size)) onResize(s);
          }}
        >
          <SelectTrigger
            aria-label={`${title}’s size, columns by rows`}
            title="Size: columns by rows"
            className="h-7 w-auto shrink-0 gap-1 px-2 text-xs tabular"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {sizes.map((s) => (
              <SelectItem
                key={sizeLabel(s)}
                value={sizeLabel(s)}
                title={`${String(s.w)} column${s.w === 1 ? '' : 's'} wide, ${String(s.h)} row${s.h === 1 ? '' : 's'} tall`}
                className="tabular"
              >
                {sizeLabel(s)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <span className="px-2 text-xs text-muted-foreground tabular" title="Its one size: columns by rows">
          {sizeLabel(size)}
        </span>
      )}
      <span className="flex-1" />
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        data-control="earlier"
        aria-label={`Move ${title} earlier`}
        title="Earlier"
        disabled={first}
        onClick={() => {
          onMove('earlier');
        }}
      >
        <ArrowLeftIcon />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        data-control="later"
        aria-label={`Move ${title} later`}
        title="Later"
        disabled={last}
        onClick={() => {
          onMove('later');
        }}
      >
        <ArrowRightIcon />
      </Button>
      <Button variant="ghost" size="icon" className="size-7" aria-label={`Remove ${title}`} title="Remove" onClick={onRemove}>
        <XIcon />
      </Button>
    </div>
  );
}
