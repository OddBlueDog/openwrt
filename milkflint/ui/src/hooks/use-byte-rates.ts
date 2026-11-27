// A device's speed from a counter read now and then: each read against the
// one before, paired once each by when it came.
import { useState } from 'react';
import { useLive } from '@/lib/query/use-live';
import { ratesBetween, type ByteSample } from '@/lib/rates';
import { hookQueries } from './queries';

export interface ByteRates {
  down?: number | undefined;
  up?: number | undefined;
  kind?: 'wifi' | 'wired' | undefined;
}

/**
 * Reads `sample` for the device `who` names, waiting `everyMs(last sample)`
 * between reads; stops when the component unmounts or the tab is hidden.
 */
export function useByteRates(
  who: readonly string[],
  sample: () => Promise<ByteSample | undefined>,
  everyMs: (last: ByteSample | undefined) => number,
): ByteRates {
  const { data, at } = useLive(
    hookQueries.byteSample(
      who,
      async () => (await sample()) ?? null,
      (last) => everyMs(last ?? undefined),
    ),
  );
  const [pair, setPair] = useState<{ at: number | undefined; prev: ByteSample | undefined; rates: ByteRates }>({
    at: undefined,
    prev: undefined,
    rates: {},
  });
  if (data !== undefined && at !== pair.at) {
    // nothing to add up this time: the next figure starts over
    const rates = data === null ? {} : { ...ratesBetween(pair.prev, data, data.kind === 'wired'), kind: data.kind };
    setPair({ at, prev: data ?? undefined, rates });
  }
  return pair.rates;
}
