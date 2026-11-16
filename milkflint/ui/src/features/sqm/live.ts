// The Smart Queue page's live view, every 2 s: each shaping direction's CAKE
// (./cake.ts) with its queues in order, each queue's rate and the CPU it runs
// on, from the same reading Performance Tuning's lanes use.
import { type NetworkLive, queueKey, useNetworkLive } from '@/hooks/use-network-live';
import { type Direction, type DirectionSummary, directionsOf, summarize } from './cake';
import { queueNumber, totalRate } from './surface';

export interface LiveDirection extends Direction {
  /** each queue's bit rate, in the order of `queues` */
  rates: (number | undefined)[];
  /** the CPU each queue runs on, when an RSS ring pinned to one feeds it */
  cpus: (number | undefined)[];
  /** the direction's rate: its queues' together */
  rate: number | undefined;
  summary: DirectionSummary;
}

export interface SqmLive {
  directions: LiveDirection[];
  net: NetworkLive;
}

export function useSqmLive(): { data: SqmLive | undefined; error: unknown } {
  const { data, error } = useNetworkLive(2000);
  if (data === undefined) return { data: undefined, error };
  const cpuOf = new Map(data.queues.map((q) => [q.key, q.cpu]));
  const directions = directionsOf(data.qdiscs).map((d): LiveDirection => {
    const queues = [...d.queues].sort((a, b) => queueNumber(a) - queueNumber(b));
    const rates = queues.map((q) => data.rates.get(queueKey(q)));
    return {
      ...d,
      queues,
      rates,
      cpus: queues.map((q) => cpuOf.get(queueKey(q))),
      rate: totalRate(rates),
      summary: summarize(d),
    };
  });
  return { data: { directions, net: data }, error };
}
