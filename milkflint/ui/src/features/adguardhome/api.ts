import { z } from 'zod';
import { call } from '@/lib/ubus';

/** A setting the DNS chain needs that's not as MilkFlint wrote it (changed in AdGuard Home's own web interface, or by hand). */
const settingSchema = z.object({
  key: z.string(),
  have: z.unknown(),
  want: z.unknown(),
  /** Lookups or the router suffer (else it's only a note). */
  breaks: z.boolean(),
  what: z.string(),
});
export type Setting = z.output<typeof settingSchema>;

const updateSchema = z.object({
  busy: z.boolean().nullish(),
  action: z.string().nullish(),
  checked: z.number().nullish(),
  installed: z.string().nullish(),
  latest: z.string().nullish(),
  /** The feed's versions, newest first. */
  versions: z.array(z.string()).nullish(),
  /** Installed as an earlier one (adguardhome@milkflint=<version> in apk's world). */
  pinned: z.string().nullish(),
  ok: z.boolean().nullish(),
  error: z.string().nullish(),
  log: z.string().nullish(),
  finished: z.number().nullish(),
});
export type UpdateInfo = z.output<typeof updateSchema>;

const networkSchema = z.object({ interface: z.string(), zone: z.string(), ipv4: z.array(z.string()), ipv6: z.array(z.string()) });
export type Network = z.output<typeof networkSchema>;

export const STATES = ['off', 'starting', 'active', 'fallback'] as const;
export type State = (typeof STATES)[number];

const statusSchema = z.object({
  installed: z.boolean(),
  enabled: z.boolean().optional(),
  /** Its settings file is there (written the first time it's turned on). */
  configured: z.boolean().optional(),
  mode: z.enum(['router', 'ap']).optional(),
  running: z.boolean().optional(),
  memory_kb: z.number().nullish(),
  /** The installed package's version, e.g. 0.107.80-r1. */
  version: z.string().nullish(),
  /** The account to sign in to its web interface with. */
  user: z.string().nullish(),
  url: z.string().optional(),
  dns_port: z.number().optional(),
  /** The monitor's: active (devices' lookups go to it), starting, fallback (dnsmasq answers them, unfiltered), off. */
  state: z.enum(STATES).optional(),
  reason: z.string().nullish(),
  since: z.number().nullish(),
  checked: z.number().nullish(),
  /** The interfaces whose lookups to the router, and whose caught lookups, go to it. */
  redirect: z.object({ home: z.array(z.string()), intercept: z.array(z.string()) }).optional(),
  /** Its own statistics: lookups and blocked ones in its window (hours). */
  stats: z.object({ queries: z.number(), blocked: z.number(), hours: z.number(), avg_ms: z.number().nullish() }).nullish(),
  settings: z.array(settingSchema).optional(),
  networks: z.array(networkSchema).optional(),
  update: updateSchema.nullish(),
  licenses: z.object({ license: z.string(), notices: z.string() }).optional(),
});
export type AdGuardStatus = z.output<typeof statusSchema>;

export function getAdGuardStatus(): Promise<AdGuardStatus> {
  return call('milkflint.adguardhome', 'status', {}, statusSchema);
}

const resultSchema = z.object({ ok: z.boolean().optional(), error: z.string().optional(), left: z.array(z.string()).optional() });

const errors: Record<string, string> = {
  not_installed: 'AdGuard Home isn’t in this firmware.',
  not_configured: 'Turn it on first: that writes its settings.',
  access_point: 'In access point mode the main router answers DNS.',
  user: 'The user name: letters, digits and . _ @ - (not “milkflint”, MilkFlint’s own).',
  password: 'The password: 8 to 72 characters, on one line.',
  hash: 'The router couldn’t make the password’s hash.',
  write: 'The router couldn’t write AdGuard Home’s settings.',
  version: 'That version isn’t in MilkFlint’s package feed.',
  busy: 'An update is running already.',
};

async function act(method: string, params: Record<string, unknown>): Promise<z.output<typeof resultSchema>> {
  const r = await call('milkflint.adguardhome', method, params, resultSchema);
  if (r.error !== undefined) throw new Error(errors[r.error] ?? `The router couldn’t: ${r.error}.`);
  return r;
}

/** The first time: writes its settings with this user and password, then turns it on. */
export async function setupAdGuard(user: string, password: string): Promise<void> {
  await act('setup', { user, password });
}

export async function enableAdGuard(on: boolean): Promise<void> {
  await act('enable', { on });
}

export async function setCredentials(user: string, password: string): Promise<void> {
  await act('credentials', { user, password });
}

/** Puts back the settings the DNS chain needs; the keys still not right. */
export async function repairAdGuard(): Promise<string[]> {
  return (await act('repair', {})).left ?? [];
}

export async function checkUpdates(): Promise<void> {
  await act('update_check', {});
}

/** Installs that version from MilkFlint's feed ('' for the newest), in the background. */
export async function installVersion(version: string): Promise<void> {
  await act('update', { version });
}
