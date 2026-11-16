// A bar stuck to the top of the window covers whatever scrolls under it, so
// a control reached with the keyboard could land out of sight (WCAG 2.2,
// 2.4.11 Focus Not Obscured). This keeps the bar's height in --mf-sticky-top
// on <html>, which styles.css adds to the page's scroll-padding-top: the
// browser then scrolls a focused control clear of the bar. The phone's bar
// is the one that sticks (the wide top bar scrolls with the page, and the
// side rail is beside it); hidden at a width, it counts as 0.
import { type RefObject, useEffect } from 'react';

export function useStickyOffset(bar: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const root = document.documentElement;
    const update = (): void => {
      const el = bar.current;
      const height = el !== null && el.getClientRects().length > 0 ? el.getBoundingClientRect().height : 0;
      root.style.setProperty('--mf-sticky-top', `${String(height)}px`);
    };
    const observer = new ResizeObserver(update);
    if (bar.current !== null) observer.observe(bar.current);
    window.addEventListener('resize', update);
    update();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
      root.style.removeProperty('--mf-sticky-top');
    };
  }, [bar]);
}
