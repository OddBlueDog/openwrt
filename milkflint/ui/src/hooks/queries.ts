// What the shared live hooks read (see ARCHITECTURE.md): the network's
// pipeline for use-network-live, and a device's byte counters for
// use-byte-rates.
import { getPipeline, type Pipeline } from '@/lib/api/pipeline';
import { type CakeQdisc, getSqmStatus } from '@/lib/api/stats';
import { type Every, type LiveQuery, liveQuery } from '@/lib/query/options';
import type { ByteSample } from '@/lib/rates';

export interface NetworkSample {
  pipeline: Pipeline;
  qdiscs: CakeQdisc[];
  at: number;
}

/** One reading of the network's pipeline and Smart Queue's queues, with when it was read (performance.now(), for rates). */
async function networkSample(): Promise<NetworkSample> {
  const [pipeline, sqm] = await Promise.all([getPipeline(), getSqmStatus().catch(() => ({ qdiscs: [] as CakeQdisc[] }))]);
  return { pipeline, qdiscs: sqm.qdiscs, at: performance.now() };
}

export const hookQueries = {
  /** the network's pipeline and queues, every `every` ms */
  networkSample: (every: number): LiveQuery<NetworkSample> => liveQuery(['network-live', every], networkSample, every),
  /**
   * One device's byte counters (`who`: its MAC and how it's linked), read by
   * `sample` at the pace `every` gives; null when there's nothing to add up.
   */
  byteSample: (
    who: readonly string[],
    sample: () => Promise<ByteSample | null>,
    every: Every<ByteSample | null>,
  ): LiveQuery<ByteSample | null> => liveQuery(['byte-rates', ...who], sample, every),
};
