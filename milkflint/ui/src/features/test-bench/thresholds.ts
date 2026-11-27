// This browser's thresholds for the report's checks (the Thresholds panel),
// kept in localStorage; every report on the page grades with them, and
// follows a change at once.
import { storedValue } from '../../lib/stored';
import { defaultThresholds, parseThresholds, type Thresholds } from './checks';

const store = storedValue('milkflint.bench.thresholds', parseThresholds, defaultThresholds);

/** Keep `t` as this browser's thresholds (undefined: back to the defaults). */
export function saveThresholds(t: Thresholds | undefined): void {
  store.save(t);
}

export function useThresholds(): Thresholds {
  return store.use();
}
