import { z } from 'zod';
import { call } from '@/lib/ubus';
import type { Entry } from './layout';

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

/** The name prefix of the sample sensors `pnpm dev` shows when the router (the VM) has none (src/dev/sample-sensors.ts). */
export const SAMPLE_SENSOR = 'dev-sample-';

/** The router's temperatures over the last hour, recorded on the router whether or not a page is open. */
export function getSensorHistory(): Promise<SensorHistory> {
  return call('milkflint.sensors', 'history', { since: 0 }, sensorHistory);
}

// Home's layout, the same for every device. The reply is data from outside:
// the page reads it only through parseLayout (layout.ts), never as it is.
// With none saved the router answers {}, which reaches the page as no data at all.
const homeReply = z.object({ widgets: z.unknown() }).nullish();

/** The layout the user saved, as the router keeps it; undefined while Home follows the theme's. */
export async function getHomeLayout(): Promise<unknown> {
  return (await call('milkflint.home', 'get', {}, homeReply))?.widgets;
}

const saveReply = z.union([z.object({ saved: z.literal(true) }), z.object({ error: z.string() })]);

/** Saves the user's layout for every device (each widget and its size, in order); undefined goes back to the theme's. */
export async function setHomeLayout(widgets: readonly Entry[] | undefined): Promise<void> {
  const args = widgets === undefined ? {} : { widgets: widgets.map(({ id, size }) => ({ id, size })) };
  const reply = await call('milkflint.home', 'set', args, saveReply);
  if ('error' in reply) throw new Error(`The router didn’t save Home’s layout (${reply.error}).`);
}
