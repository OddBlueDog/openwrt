import { z } from 'zod';
import { getConfig, type Section } from '@/lib/api/uci';
import { call } from '@/lib/ubus';
import { type TuningData, tuningData } from './model';
import type { WedConfig } from './wed';

const groPortSchema = z.object({
  /** the internet port's hardware device (eth1) */
  dev: z.string(),
  /** what the settings resolve to, and what Automatic picks */
  mode: z.enum(['fraglist', 'plain', 'off']),
  auto: z.enum(['fraglist', 'plain']),
  /** UDP GRO forwarding, and the largest plain GRO packet (bytes), as set */
  udp: z.boolean(),
  max: z.number(),
  /** Smart Queue's download CAKE takes GRO packets whole (no-split-gso) */
  whole: z.boolean(),
  /** the firewall's software (or hardware) flow offloading is on */
  offload: z.boolean(),
  /** what the port does now; null where ethtool or ip didn't say */
  now: z.object({
    gro: z.boolean().nullable(),
    list: z.boolean().nullable(),
    udp: z.boolean().nullable(),
    max: z.number().nullable(),
  }),
});
export type GroPort = z.output<typeof groPortSchema>;

const statusSchema = z.object({
  /** each radio's best-effort AQL limits and the total that holds devices to the low one, in µs (an older router has no total) */
  radios: z.array(
    z.object({ phy: z.string(), low: z.number(), high: z.number(), threshold: z.number().nullable().default(null) }),
  ),
  steering: z.object({
    cpus: z.number(),
    /** where the Ethernet receive (NAPI) threads may run */
    ethernet: z.array(z.number()),
    /** where the Wi-Fi driver's threads may run */
    wifi: z.array(z.number()),
    /** what the wired ports receive is spread over (RPS); empty when it stays where it arrives */
    rps: z.array(z.number()),
    /** an Ethernet receive thread runs at real-time priority */
    realtime: z.boolean().default(false),
  }),
  /** the internet port's GRO (empty without one, or on an older router) */
  gro: z.array(groPortSchema).default([]),
  /** the kernel's scheduling (an older router doesn't say) */
  kernel: z
    .object({
      /** ticks a second, fixed when the kernel is built; null when it can't be told yet */
      hz: z.number().nullable(),
      /** whether the kernel records how long threads wait for a CPU */
      waits: z.boolean(),
    })
    .default({ hz: null, waits: false }),
  /** the drivers' latency settings as they are now; null where the image (or a stopped Smart Queue) lacks one */
  knobs: z
    .object({
      /** the Ethernet's longest receive interrupt delay, µs; 0 no limit */
      rx_delay: z.number().nullable(),
      /** experimental: each receive ring picks its own interrupt delay (mtk_eth's rx_dim_per_ring); null without it */
      rx_dim_per_ring: z.boolean().nullable().default(null),
      /** experimental: send-complete interrupts follow sending's moderation (mtk_eth's qdma_tx_dim); null without it */
      qdma_tx_dim: z.boolean().nullable().default(null),
      /** the CPUs the switch port's first receive queue hands its packets on to (RPS); null without a switch port */
      lan_rps: z.array(z.number()).nullable().default(null),
      /** sch_cake's ecn_fail_count: 0 always marks */
      cake_ecn: z.number().nullable(),
      /** sch_cake's l4s_ramp: where L4S traffic starts to be marked, in percent of its target; 0 not at all */
      cake_l4s: z.number().nullable().default(null),
      /** whether sch_cake is loaded: Smart Queue has run since boot */
      cake_loaded: z.boolean().default(false),
      /** experimental: sch_cake drops one packet of a group it takes whole (drop_one_segment) */
      cake_drop_one_segment: z.boolean().nullable().default(null),
      /** experimental: how far ahead of the shaper a new flow's packet may go on a download, µs; 0 off (sparse_ahead_us) */
      cake_sparse_ahead: z.number().nullable().default(null),
      /** experimental: packets sch_cake dropped one of a group since it loaded (one_segment_drops); null without the counter */
      cake_one_segment_drops: z.number().nullable().default(null),
      /** the Wi-Fi driver's sends of a data frame */
      wifi_retries: z.number().nullable(),
      /** whether the Wi-Fi driver aggregates the voice queue; null without the setting, or on an older router */
      wifi_vo_aggr: z.boolean().nullable().default(null),
    })
    .default({
      rx_delay: null,
      rx_dim_per_ring: null,
      qdma_tx_dim: null,
      lan_rps: null,
      cake_ecn: null,
      cake_l4s: null,
      cake_loaded: false,
      cake_drop_one_segment: null,
      cake_sparse_ahead: null,
      cake_one_segment_drops: null,
      wifi_retries: null,
      wifi_vo_aggr: null,
    }),
  /** hardware offloading with WED (./wed.ts); an older router doesn't say */
  wed: z
    .object({
      /** the setting asks for it */
      wanted: z.boolean(),
      /** how the loaded Wi-Fi driver has it, which it takes when the router starts; null without the driver */
      loaded: z.boolean().nullable(),
      /** a radio is attached to the chip's WED right now */
      active: z.boolean(),
    })
    .optional(),
});
export type TuningStatus = z.output<typeof statusSchema>;

/** What the settings are doing right now (milkflint.tuning in this feature's rpcd plugin). */
export function getTuningStatus(): Promise<TuningStatus> {
  return call('milkflint.tuning', 'status', {}, statusSchema);
}

/** The page's settings as saved: milkflint's, the network's packet steering, Smart Queue's queue, the firewall's offloading. */
export async function loadTuning(): Promise<TuningData> {
  const [milkflint, network, sqm, firewall] = await Promise.all([
    getConfig('milkflint').catch((): Section[] => []),
    getConfig('network'),
    getConfig('sqm').catch((): Section[] => []),
    getConfig('firewall').catch((): Section[] => []),
  ]);
  return tuningData({ milkflint, network, sqm, firewall });
}

/** What hardware offloading with WED (./wed.ts) reads: milkflint's, Smart Queue's and the firewall's sections. */
export async function loadWed(): Promise<WedConfig> {
  const [milkflint, sqm, firewall] = await Promise.all([
    getConfig('milkflint').catch((): Section[] => []),
    getConfig('sqm').catch((): Section[] => []),
    getConfig('firewall').catch((): Section[] => []),
  ]);
  return { milkflint, sqm, firewall };
}
