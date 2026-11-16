// Closing a popup the way a menu closes: Escape, or a pointer or focus
// anywhere outside it. Shared by the top bar's group menus and its tools.
import { type RefObject, useEffect } from 'react';

export function useDismiss(open: boolean, setOpen: (open: boolean) => void, root: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    if (!open) return;
    const away = (e: Event): void => {
      if (root.current !== null && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('focusin', away);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('focusin', away);
      document.removeEventListener('keydown', escape);
    };
  }, [open, setOpen, root]);
}
