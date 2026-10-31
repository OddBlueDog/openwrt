// Whether MilkFlint is the main router or an access point on another
// router's network (the Operating Mode page). In access point mode the pages
// that only mean something on a router leave the menu. Asked when the app
// shell opens (signed in) and again after a switch; a router that can't say
// (an image without the feature) is a router.
import { useSyncExternalStore } from 'react';
import { z } from 'zod';
import { call } from './ubus';

export type RouterMode = 'router' | 'ap';

let mode: RouterMode | undefined;
const listeners = new Set<() => void>();

function update(next: RouterMode): void {
  if (next === mode) return;
  mode = next;
  for (const listener of listeners) listener();
}

/** Ask the router again, as after a switch. */
export async function refreshRouterMode(): Promise<void> {
  try {
    const r = await call('milkflint.mode', 'status', {}, z.object({ mode: z.enum(['router', 'ap']) }).loose());
    update(r.mode);
  } catch {
    update(mode ?? 'router');
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The mode; undefined until the router has said. */
export function useRouterMode(): RouterMode | undefined {
  return useSyncExternalStore(subscribe, () => mode);
}
