// This browser's thresholds for the report's checks (the Thresholds panel),
// kept in localStorage; every report on the page grades with them, and
// follows a change at once.
import { useSyncExternalStore } from 'react';
import { defaultThresholds, parseThresholds, type Thresholds } from './checks';

const KEY = 'milkflint.bench.thresholds';
let current: Thresholds | undefined;
const listeners = new Set<() => void>();

function read(): Thresholds {
  if (current === undefined) {
    try {
      current = parseThresholds(JSON.parse(localStorage.getItem(KEY) ?? 'null'));
    } catch {
      // no storage here (a private window): the defaults
      current = defaultThresholds();
    }
  }
  return current;
}

/** Keep `t` as this browser's thresholds (undefined: back to the defaults). */
export function saveThresholds(t: Thresholds | undefined): void {
  current = t ?? defaultThresholds();
  try {
    if (t === undefined) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(t));
  } catch {
    // kept for this page only
  }
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useThresholds(): Thresholds {
  return useSyncExternalStore(subscribe, read);
}
