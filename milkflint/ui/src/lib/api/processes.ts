import { z } from 'zod';
import { call } from '@/lib/ubus';

// MilkFlint's own rpcd plugin (source/feed/milkflint-ui/files/rpcd.uc):
// every process, as top lists them. CPU time is in clock ticks; two
// readings make each process's share of the processor (processes/model.ts).
const processSchema = z.object({
  pid: z.number(),
  ppid: z.number(),
  /** the kernel's name for it (comm): at most 15 characters */
  name: z.string(),
  /** proc(5)'s state letter: R running, S sleeping, D waiting on a device, I idle, Z zombie, T stopped */
  state: z.string(),
  /** user plus system CPU time since it started, in clock ticks (100 a second) */
  ticks: z.number(),
  threads: z.number(),
  /** when it started, in clock ticks since the router booted */
  start: z.number(),
  kernel: z.boolean(),
  user: z.string(),
  /** bytes held in memory (the resident set); 0 for a kernel thread */
  rss: z.number(),
  /** its command line, passwords blanked; empty for a kernel thread */
  cmd: z.string(),
});
export type Process = z.output<typeof processSchema>;

const processListSchema = z.object({
  /** seconds since the router booted */
  uptime: z.number(),
  /** clock ticks summed over every core, and how many of them were idle */
  cpu: z.object({ total: z.number(), idle: z.number() }),
  cores: z.number(),
  memory: z.object({ total: z.number(), available: z.number() }),
  processes: z.array(processSchema),
});
export type ProcessList = z.output<typeof processListSchema>;

export function getProcesses(): Promise<ProcessList> {
  return call('milkflint', 'processes', {}, processListSchema);
}
