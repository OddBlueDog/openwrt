import { z } from 'zod';
import { call } from '@/lib/ubus';

// The dashboard feature's rpcd plugin (source/feed/milkflint-ui/files/features/dashboard/).
const sensorSample = z.object({
  /** epoch seconds */
  t: z.number(),
  /** °C by sensor name, as in milkflint.stats' temperatures */
  c: z.record(z.string(), z.number()),
});
export type SensorSample = z.output<typeof sensorSample>;

const sensorHistory = z.object({
  now: z.number(),
  /** seconds between samples; null before the recorder's first one */
  interval: z.number().nullable(),
  samples: z.array(sensorSample),
});
export type SensorHistory = z.output<typeof sensorHistory>;

/** The router's temperatures over the last hour, recorded on the router whether or not a page is open. */
export function getSensorHistory(): Promise<SensorHistory> {
  return call('milkflint.sensors', 'history', { since: 0 }, sensorHistory);
}
