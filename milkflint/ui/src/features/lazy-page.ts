import { type ComponentType, lazy, type LazyExoticComponent } from 'react';

const RELOADED = 'milkflint.reloaded-for-update';

/**
 * A page component loaded on first visit (its own bundle chunk). If the chunk
 * is gone because the router was updated while this tab was open, reload once
 * to pick up the new version instead of failing.
 */
export function lazyPage<M>(load: () => Promise<M>, pick: (module: M) => ComponentType): LazyExoticComponent<ComponentType> {
  return lazy(async () => {
    try {
      const page = pick(await load());
      try {
        sessionStorage.removeItem(RELOADED);
      } catch {
        // storage unavailable: nothing to clear
      }
      return { default: page };
    } catch (err) {
      let reloadedAlready = true;
      try {
        reloadedAlready = sessionStorage.getItem(RELOADED) !== null;
        sessionStorage.setItem(RELOADED, '1');
      } catch {
        // storage unavailable: don't risk a reload loop
      }
      if (!reloadedAlready) {
        window.location.reload();
        return new Promise<never>(() => undefined);
      }
      throw err;
    }
  });
}
