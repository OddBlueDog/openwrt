// The theme's say over how much the interface explains and decorates
// (theme.presentation), as hooks for the shared components. The "?" itself
// is components/on-request.tsx.
import { useId, useState } from 'react';
import { useTheme } from '@/lib/theme';

/** True when the theme keeps explanations behind a "?". */
export function useOnRequest(): boolean {
  return useTheme().theme.presentation.explanations === 'on-request';
}

/** A "?" and the panel it opens: whether it's open, the toggle, and the panel's id. */
export function useAsk(): { open: boolean; toggle: () => void; panelId: string } {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return {
    open,
    toggle: () => {
      setOpen((o) => !o);
    },
    panelId,
  };
}

/** Whether a slot was given something to show (`cond && <…/>` gives false when not). */
export function shown(node: unknown): boolean {
  return node !== undefined && node !== null && node !== false && node !== '';
}

/** False when the theme hides icons that only decorate (widget titles, the menu, search results). */
export function useDecorativeIcons(): boolean {
  return useTheme().theme.presentation.decorativeIcons === 'shown';
}

/** True when warning and destructive states carry a "!" (a theme whose states share a colour). */
export function useStateSymbols(): boolean {
  return useTheme().theme.presentation.stateMarks === 'symbol';
}

/** True when the top bar marks the current page with an underline rather than a filled pill. */
export function useNavUnderline(): boolean {
  return useTheme().theme.presentation.navCurrent === 'underline';
}
