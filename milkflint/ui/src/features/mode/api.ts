import { z } from 'zod';
import type { Change } from '@/lib/api/uci';
import { call } from '@/lib/ubus';
import type { ApRequest } from './model';

/** An interface's IPv4 addressing, as netifd has it now. */
const addressing = z
  .object({
    up: z.boolean(),
    ipaddr: z.string().nullish(),
    prefix: z.number().nullish(),
    gateway: z.string().nullish(),
    dns: z.array(z.string()).optional(),
  })
  .loose();
export type Addressing = z.output<typeof addressing>;

const mode = z.enum(['router', 'ap']);

/** The switch under way, or the last one (it goes back to `from` if the new mode didn't work). */
const lastSwitch = z
  .object({
    state: z.enum(['switching', 'done', 'failed']),
    target: mode.optional(),
    from: mode.optional(),
    mode: mode.optional(),
    started: z.number().optional(),
    finished: z.number().optional(),
    error: z.string().optional(),
    address: z.string().nullish(),
    prefix: z.number().nullish(),
    gateway: z.string().nullish(),
  })
  .loose();
export type LastSwitch = z.output<typeof lastSwitch>;

const status = z.object({
  /** the router's clock, unix seconds: switches are timed by it */
  now: z.number(),
  mode,
  /** access point mode set up by hand (OpenWrt's recipe, LuCI), not on this page: router mode means OpenWrt's defaults */
  handmade: z.boolean().optional(),
  switching: z.boolean(),
  last: lastSwitch.nullish(),
  /** the board's WAN port, which access point mode adds to the LAN */
  wan_port: z.string().nullish(),
  /** the LAN interface as configured */
  lan: z.object({
    proto: z.string(),
    ipaddr: z.string().nullish(),
    netmask: z.string().nullish(),
    gateway: z.string().nullish(),
    dns: z.array(z.string()),
  }),
  /** ... and as it is now */
  lan_now: addressing.nullish(),
  /** router mode: the WAN, which is the network an access point would join */
  uplink: addressing.nullish(),
  /** access point mode: the LAN address router mode puts back */
  router_address: z.string().nullish(),
  /** the firewall's defaults section, which has fw4's flow_offloading_bridge */
  firewall_defaults: z.string().nullish(),
  bridge_offload: z.boolean(),
  bridge_offload_available: z.boolean(),
});
export type ModeStatus = z.output<typeof status>;

export function getModeStatus(): Promise<ModeStatus> {
  return call('milkflint.mode', 'status', {}, status);
}

const switchResult = z.union([
  z.object({ started: z.literal(true), at: z.number(), seconds: z.number() }),
  z.object({ error: z.string() }),
]);

/**
 * Starts the switch; the router does it in the background, and the page
 * loses its connection. `at` is when it started, by the router's clock.
 */
export async function switchMode(request: ApRequest | { mode: 'router' }): Promise<{ at: number; seconds: number }> {
  const res = await call('milkflint.mode', 'switch', { ...request }, switchResult);
  if ('error' in res) throw new Error(`The router refused: ${res.error}`);
  return { at: res.at, seconds: res.seconds };
}

/** fw4's flow_offloading_bridge on the firewall's defaults section, to apply with rollback. */
export function bridgeOffloadChange(section: string, on: boolean): Change {
  return { op: 'set', config: 'firewall', section, values: { flow_offloading_bridge: on ? '1' : '0' } };
}
