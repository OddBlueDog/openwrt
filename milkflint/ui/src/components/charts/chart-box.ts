// What every chart on TanStack Charts here shares (time-chart.tsx,
// bar-chart.tsx): the height of the box it's drawn in, as it changes, and
// the theme's colours for its guides.
import { type RefObject, useEffect, useRef, useState } from 'react';

/** The scale's text and the grid, in the theme's colours. */
export const CHART_THEME = {
  foreground: 'var(--muted-foreground)',
  muted: 'var(--muted-foreground)',
  grid: 'var(--chart-grid)',
};

/** The height of an element, as it changes (0 until measured). */
export function useHeight(): [RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const ro = new ResizeObserver(([e]) => {
      setH(Math.floor(e?.contentRect.height ?? 0));
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, []);
  return [ref, h];
}
