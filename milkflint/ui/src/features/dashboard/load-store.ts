// The pings Home has paired with the line's load (model.ts, pairPings),
// kept for this tab at module level, so leaving Home and coming back keeps
// what it measured. Only while Home is open: nothing records it otherwise.
import { useSyncExternalStore } from 'react';
import { type LoadPair, mergePairs } from './model';

let pairs: readonly LoadPair[] = [];
const listeners = new Set<() => void>();

/** Adds newly paired pings, dropping those older than the hour Home keeps. */
export function addLoadPairs(fresh: readonly LoadPair[], now: number): void {
  if (fresh.length === 0) return;
  pairs = mergePairs(pairs, fresh, now);
  for (const listener of listeners) listener();
}

/** The newest paired ping's time (router clock), or 0: pings after it still want a rate. */
export function lastPairedAt(): number {
  return pairs[pairs.length - 1]?.t ?? 0;
}

export function useLoadPairs(): readonly LoadPair[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => pairs,
  );
}
