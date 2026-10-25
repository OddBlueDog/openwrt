import { z } from 'zod';
import { call } from '@/lib/ubus';

// MilkFlint's own rpcd plugin (source/feed/milkflint-ui/files/rpcd.uc).
const statsSchema = z.object({
  cpu: z.array(
    z.object({
      name: z.string(),
      total: z.number(),
      idle: z.number(),
      /** time in softirq: on a router, mostly forwarding, NAT and Smart Queue */
      softirq: z.number().optional(),
    }),
  ),
  temperatures: z.array(
    z.object({
      name: z.string(),
      celsius: z.number(),
      /** the radio's phy (phy0) for a Wi-Fi sensor */
      wiphy: z.string().nullable().optional(),
      /** the network port (eth1, lan1) for an Ethernet PHY's sensor */
      port: z.string().nullable().optional(),
    }),
  ),
  conntrack: z.object({ count: z.number().nullable(), max: z.number().nullable() }),
});
export type Stats = z.output<typeof statsSchema>;

export function getStats(): Promise<Stats> {
  return call('milkflint', 'stats', {}, statsSchema);
}

const cakeTin = z
  .object({
    threshold_rate: z.number().optional(),
    sent_bytes: z.number().optional(),
    backlog_bytes: z.number().optional(),
    target_us: z.number().optional(),
    peak_delay_us: z.number().optional(),
    avg_delay_us: z.number().optional(),
    base_delay_us: z.number().optional(),
    sent_packets: z.number().optional(),
    drops: z.number().optional(),
    ecn_mark: z.number().optional(),
    ack_drops: z.number().optional(),
    sparse_flows: z.number().optional(),
    bulk_flows: z.number().optional(),
  })
  .loose();

const cakeQdisc = z
  .object({
    /** cake_mq: multi-queue CAKE's root, with one cake per transmit queue under it */
    kind: z.enum(['cake', 'cake_mq']),
    dev: z.string(),
    handle: z.string().optional(),
    /** a cake_mq sub-queue's "<root handle>:<queue number, hex>" */
    parent: z.string().optional(),
    root: z.boolean().optional(),
    bytes: z.number().optional(),
    packets: z.number().optional(),
    drops: z.number().optional(),
    backlog: z.number().optional(),
    options: z
      .object({
        bandwidth: z.union([z.number(), z.string()]).optional(),
        diffserv: z.string().optional(),
        overhead: z.number().optional(),
      })
      .loose()
      .optional(),
    capacity_estimate: z.number().optional(),
    memory_used: z.number().optional(),
    /** a cake_mq sub-queue: how many of its siblings share the speed right now */
    active_queues: z.number().optional(),
    tins: z.array(cakeTin).optional(),
  })
  .loose();
export type CakeTin = z.output<typeof cakeTin>;
export type CakeQdisc = z.output<typeof cakeQdisc>;

export const sqmStatusSchema = z.object({
  qdiscs: z.array(cakeQdisc),
  /** which CPUs handle the WAN port's packets (MilkFlint's packet steering) */
  steering: z
    .object({
      cpus: z.number(),
      /** where the Ethernet receive (NAPI) threads run */
      napi: z.array(z.number()),
      /** what received packets are spread over (RPS); empty when they stay on the receiving CPU */
      rps: z.array(z.number()),
    })
    .optional(),
});
export type SqmStatus = z.output<typeof sqmStatusSchema>;

export function getSqmStatus(): Promise<SqmStatus> {
  return call('milkflint', 'sqm_status', {}, sqmStatusSchema);
}
