import { z } from 'zod';
import { call, exec } from '@/lib/ubus';

const boardSchema = z.object({
  hostname: z.string(),
  model: z.string().optional(),
  board_name: z.string().optional(),
  kernel: z.string().optional(),
  system: z.string().optional(),
  rootfs_type: z.string().optional(),
  release: z
    .object({
      distribution: z.string().optional(),
      version: z.string().optional(),
      revision: z.string().optional(),
      description: z.string().optional(),
    })
    .optional(),
});
export type Board = z.output<typeof boardSchema>;

/**
 * The firmware's name, e.g. "MilkFlint 0.1a (OpenWrt 25.12.6) r33311-981c978eff".
 * release.version carries the OpenWrt release under MilkFlint's own number;
 * release.description (OPENWRT_RELEASE) leaves it out.
 */
export function firmwareName(release: Board['release']): string | undefined {
  if (release?.distribution === undefined || release.version === undefined) return release?.description;
  return [release.distribution, release.version, release.revision].filter(Boolean).join(' ');
}

const diskSchema = z.object({ total: z.number(), free: z.number(), used: z.number(), avail: z.number() });

const infoSchema = z.object({
  localtime: z.number(),
  uptime: z.number(),
  /** 1, 5 and 15 minute load averages, scaled by 65536 (procd). */
  load: z.tuple([z.number(), z.number(), z.number()]),
  memory: z.object({
    total: z.number(),
    free: z.number(),
    shared: z.number(),
    buffered: z.number(),
    available: z.number().optional(),
    cached: z.number().optional(),
  }),
  root: diskSchema.optional(),
  tmp: diskSchema.optional(),
  swap: z.object({ total: z.number(), free: z.number() }).optional(),
});
export type SystemInfo = z.output<typeof infoSchema>;

export function getBoard(): Promise<Board> {
  return call('system', 'board', {}, boardSchema);
}

export function getInfo(): Promise<SystemInfo> {
  return call('system', 'info', {}, infoSchema);
}

export function reboot(): Promise<void> {
  return exec('system', 'reboot');
}

const zonesSchema = z.record(z.string(), z.object({ tzstring: z.string().optional(), active: z.boolean().optional() }).loose());

/** OpenWrt's time zone names with their POSIX TZ strings (LuCI's list). */
export async function getTimezones(): Promise<{ name: string; tz: string }[]> {
  const zones = await call('luci', 'getTimezones', {}, zonesSchema);
  return Object.entries(zones)
    .map(([name, z]) => ({ name, tz: z.tzstring ?? 'UTC0' }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function setPassword(password: string): Promise<void> {
  return exec('luci', 'setPassword', { username: 'root', password });
}

/** The router's clock as seconds since 1970, UTC (system info's localtime includes the zone offset). */
export function getUnixtime(): Promise<number> {
  return call('luci', 'getUnixtime', {}, z.object({ result: z.number() })).then((r) => r.result);
}

/** Set the router's clock (seconds since 1970, UTC). */
export function setLocaltime(epochSeconds: number): Promise<void> {
  return exec('luci', 'setLocaltime', { localtime: epochSeconds });
}
