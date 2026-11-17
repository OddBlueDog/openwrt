// A widget is the size it's given (layout.ts), so what doesn't fit in it
// isn't shown: the parts of a box marked `data-fit` (a list's rows, a note,
// the details under a tile's figure) are hidden whole, the last first (a
// part ranked `data-fit="2"` before the rest), until the rest fits in the
// box. Measured after every draw (live figures change, and a busiest-first
// order with them), and whenever the box or what's in it changes size (a
// part inside that draws on its own, a list that appears later). On a phone,
// where a widget is as tall as it needs, everything fits.
//
// Every widget's body is a box (widget.tsx); a list with something under it
// that must stay (a total) is a box of its own, which its rows belong to.
import { type RefCallback, useCallback, useEffect, useLayoutEffect, useRef } from 'react';

const BOX = 'data-fit-box';

/** On a list whose rows may go: it goes too once they all have (its gap, its line above). */
export const EMPTY_GOES = '[&:not(:has(>:not([hidden])))]:hidden';

/** Whether what's in the box reaches past the foot of its content (inside any padding; half a pixel for rounding). */
function overflows(box: HTMLElement): boolean {
  const style = getComputedStyle(box);
  const foot =
    box.getBoundingClientRect().bottom - Number.parseFloat(style.paddingBottom) - Number.parseFloat(style.borderBottomWidth);
  for (const child of box.children) {
    // a part that reaches into the card's padding on purpose (a graph to its rounded foot) ends where its margin does
    const bleed = Math.min(0, Number.parseFloat(getComputedStyle(child).marginBottom));
    if (child.getBoundingClientRect().bottom + bleed > foot + 0.5) return true;
  }
  return false;
}

/** `data-fit="2"` goes before a plain `data-fit` (each band's channel line before any band's networks). */
function rank(p: HTMLElement): number {
  const n = Number(p.getAttribute('data-fit'));
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function fit(box: HTMLElement): void {
  const parts = [...box.querySelectorAll<HTMLElement>('[data-fit]')].filter((p) => p.parentElement?.closest(`[${BOX}]`) === box);
  // most widgets have room for everything: one look, and nothing to undo
  if (!parts.some((p) => p.hidden === true) && !overflows(box)) return;
  for (const p of parts) p.hidden = false;
  // the highest rank first and the last first within it, until the rest fits (whatever is reaching past the
  // foot: the parts, or what's under them)
  const order = parts.map((p, i) => ({ p, i, r: rank(p) })).sort((a, b) => (b.r === a.r ? b.i - a.i : b.r - a.r));
  for (const { p } of order) {
    if (!overflows(box)) break;
    p.hidden = true;
  }
}

/**
 * Spread on the box to fit: give it the room left (`min-h-0 flex-1` in its
 * column) and mark what can go, in the order it can go, with `data-fit`.
 * The box may come and go (a list that appears once there's something in
 * it): it's watched from whenever it's there.
 */
export function useFit<T extends HTMLElement>(): { ref: RefCallback<T>; [BOX]: '' } {
  const box = useRef<T | null>(null);
  const observer = useRef<ResizeObserver | undefined>(undefined);
  const ref = useCallback((el: T | null) => {
    observer.current?.disconnect();
    observer.current = undefined;
    box.current = el;
    if (el === null) return;
    const o = new ResizeObserver(() => {
      fit(el);
    });
    // the box, and what's in it: a part that grows on its own leaves the box's size as it is
    o.observe(el);
    for (const child of el.children) o.observe(child);
    observer.current = o;
  }, []);
  useLayoutEffect(() => {
    const el = box.current;
    if (el === null) return;
    // what's in it now (observing one already watched does nothing)
    for (const child of el.children) observer.current?.observe(child);
    fit(el);
  });
  useEffect(
    () => () => {
      observer.current?.disconnect();
    },
    [],
  );
  return { ref, [BOX]: '' };
}
