import { z } from 'zod';
import { call } from '@/lib/ubus';
import type { OutsideDns } from './programs';

const outsideSchema = z.object({
  how: z.enum(['front', 'forward']),
  program: z.string().nullish(),
  addr: z.string(),
  port: z.number(),
  file: z.string().nullish(),
}) satisfies z.ZodType<OutsideDns>;

const statusSchema = z.object({
  installed: z.boolean(),
  running: z.boolean(),
  /** A DNS program set up outside MilkFlint that devices' lookups reach; absent when there's none (and from older routers). */
  outside: outsideSchema.optional(),
});

/** Whether the encrypted-DNS proxy (AdGuard's dnsproxy) is installed and running, and a DNS program from outside MilkFlint. */
export function getDnsStatus(): Promise<z.output<typeof statusSchema>> {
  return call('milkflint.dns', 'status', {}, statusSchema);
}
