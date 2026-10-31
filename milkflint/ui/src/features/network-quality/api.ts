import { z } from 'zod';
import { call } from '@/lib/ubus';

const sampleSchema = z.object({
  /** Epoch seconds. */
  t: z.number(),
  /** Round-trip / lookup times in ms; null when there was no answer. */
  gateway: z.number().nullable(),
  internet: z.number().nullable(),
  /** The main DNS server's time (the first of dns_servers). */
  dns: z.number().nullable(),
  /** Each DNS server's time by its key (host name or address); absent from older probes. */
  dns_servers: z.record(z.string(), z.number().nullable()).optional(),
  /** Every 30 s: ms to each route's server by key (uk, eu, us), null when lost. */
  routes: z.record(z.string(), z.number().nullable()).optional(),
});
export type Sample = z.output<typeof sampleSchema>;

const routeSchema = z.object({
  key: z.string(),
  label: z.string(),
  host: z.string(),
  /** Looked up once an hour; null until it has resolved. */
  addr: z.string().nullish(),
});
export type Route = z.output<typeof routeSchema>;

const dnsTargetSchema = z.object({
  /** The samples' and history's key: the server's host name (encrypted DNS) or address. */
  key: z.string(),
  host: z.string(),
  /** The address asked; null until the host name has resolved. */
  addr: z.string().nullish(),
});
export type DnsTarget = z.output<typeof dnsTargetSchema>;

const statusSchema = z.object({
  enabled: z.boolean(),
  now: z.number(),
  interval: z.number().nullable(),
  targets: z
    .object({
      gateway: z.string().nullable(),
      internet: z.string(),
      dns_server: z.string(),
      dns_domain: z.string(),
      /** Every DNS server asked, the main one first; absent from older probes. */
      dns_servers: z.array(dnsTargetSchema).optional(),
      /** Servers in the UK, Europe and the US; absent from older routers. */
      routes: z.array(routeSchema).optional(),
    })
    .nullable(),
  /**
   * Whether the gateway has answered a ping since the probe started (or the
   * gateway changed). Many providers' gateways never do. Null without a
   * gateway; absent from older routers.
   */
  gateway_answers: z.boolean().nullish(),
  samples: z.array(sampleSchema),
});
export type Status = z.output<typeof statusSchema>;

/** [typical (median), worst, lost, rounds] over a bucket; times null when nothing answered. */
const statSchema = z.tuple([z.number().nullable(), z.number().nullable(), z.number(), z.number()]).nullable();
export type Stat = z.output<typeof statSchema>;

const bucketSchema = z.object({
  /** Bucket index: it covers start + i * step. */
  i: z.number(),
  internet: statSchema,
  dns: statSchema,
  gateway: statSchema.optional(),
  routes: z.record(z.string(), statSchema).optional(),
  dns_servers: z.record(z.string(), statSchema).optional(),
});
export type Bucket = z.output<typeof bucketSchema>;

const historySchema = z.object({
  now: z.number(),
  start: z.number(),
  step: z.number(),
  /** How many days the probe keeps (0: no history). */
  days: z.number(),
  buckets: z.array(bucketSchema),
});
export type History = z.output<typeof historySchema>;

/** The probe's minute history over the last `span` seconds, in `step`-second buckets. */
export function getHistory(span: number, step: number): Promise<History> {
  return call('milkflint.netquality', 'history', { span, step }, historySchema);
}

/** The probe daemon's state, with the samples newer than `since`. */
export function getStatus(since: number): Promise<Status> {
  return call('milkflint.netquality', 'status', { since }, statusSchema);
}
