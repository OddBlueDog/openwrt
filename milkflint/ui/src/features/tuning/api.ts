import { z } from 'zod';
import { call } from '@/lib/ubus';

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
  /** each radio's best-effort AQL limits, in µs */
  radios: z.array(z.object({ phy: z.string(), low: z.number(), high: z.number() })),
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
      /** sch_cake's ecn_fail_count: 0 always marks */
      cake_ecn: z.number().nullable(),
      /** whether sch_cake is loaded: Smart Queue has run since boot */
      cake_loaded: z.boolean().default(false),
      /** the Wi-Fi driver's sends of a data frame */
      wifi_retries: z.number().nullable(),
    })
    .default({ rx_delay: null, cake_ecn: null, cake_loaded: false, wifi_retries: null }),
});
export type TuningStatus = z.output<typeof statusSchema>;

/** What the settings are doing right now (milkflint.tuning in this feature's rpcd plugin). */
export function getTuningStatus(): Promise<TuningStatus> {
  return call('milkflint.tuning', 'status', {}, statusSchema);
}
