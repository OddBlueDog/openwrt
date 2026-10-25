import { z } from 'zod';
import { call } from '@/lib/ubus';

// Where the network work runs (milkflint.pipeline in MilkFlint's rpcd
// plugin): counters, so two samples make rates.

const irq = z.object({
  irq: z.number(),
  /** where the kernel delivers it */
  cpus: z.array(z.number()),
  /** interrupts so far, all CPUs */
  count: z.number(),
});

const thread = z.object({
  name: z.string(),
  /** the CPUs it may run on */
  cpus: z.array(z.number()),
  /** CPU time so far, in clock ticks (100 a second) */
  time: z.number(),
  /**
   * Time spent ready to run but waiting for a CPU so far, ns, and how many
   * times it got one: null (or missing, older routers) when the kernel keeps
   * no scheduler statistics
   */
  wait: z.number().nullable().optional(),
  runs: z.number().nullable().optional(),
});
export type NetThread = z.output<typeof thread>;

export const pipelineSchema = z.object({
  cpu: z.array(z.object({ name: z.string(), total: z.number(), idle: z.number(), softirq: z.number().optional() })),
  /** the Ethernet's RSS table: entries per ring; null without RSS */
  rss: z
    .object({
      dev: z.string(),
      rings: z.number(),
      table: z.array(z.number()),
      hash: z.string().nullable().optional(),
    })
    .nullable(),
  /** the Ethernet's receive rings, each with its interrupt and NAPI thread */
  rings: z.array(z.object({ ring: z.number(), irq: irq.nullable(), thread: thread.nullable() })),
  /** the Ethernet's send side */
  tx: z.object({ irq: irq.nullable(), thread: thread.nullable() }),
  /** the Ethernet's threads when they can't be told apart (no rings) */
  eth_threads: z.array(thread),
  wifi: z.object({
    irqs: z.array(irq.extend({ name: z.string() })),
    threads: z.array(thread),
  }),
  /** RPS: the CPUs each wired port's receive queues are spread over */
  rps: z.array(z.object({ dev: z.string(), queues: z.array(z.array(z.number())) })),
});
export type Pipeline = z.output<typeof pipelineSchema>;

export function getPipeline(): Promise<Pipeline> {
  return call('milkflint', 'pipeline', {}, pipelineSchema);
}
