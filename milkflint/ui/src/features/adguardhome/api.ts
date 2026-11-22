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

export const STATES = ['off', 'starting', 'active', 'fallback', 'blocking'] as const;
export type State = (typeof STATES)[number];

const statusSchema = z.object({
  installed: z.boolean(),
  enabled: z.boolean().optional(),
  /** Its settings file is there (written the first time it's turned on). */
  configured: z.boolean().optional(),
  mode: z.enum(['router', 'ap']).optional(),
  running: z.boolean().optional(),
  memory_kb: z.number().nullish(),
  /** The installed package's version, e.g. 1.0.0-r1. */
  version: z.string().nullish(),
  /** True when opening AdGuard Home from this page signs in with the router's login (no separate password). */
  router_login: z.boolean().optional(),
  /** The account to sign in to its web interface with (when router_login is off). */
  user: z.string().nullish(),
  url: z.string().optional(),
  dns_port: z.number().optional(),
  /**
   * The monitor's: active (devices' lookups go to it), starting, fallback
   * (dnsmasq answers them, unfiltered), blocking (they fail until it's back), off.
   */
  state: z.enum(STATES).optional(),
  reason: z.string().nullish(),
  since: z.number().nullish(),
  checked: z.number().nullish(),
  /** Once it has answered, lookups while it doesn't: answered unfiltered (true) or left to fail (false, the default). */
  fallback: z.boolean().optional(),
  /** The interfaces whose lookups to the router, and whose caught lookups, go to it. */
  redirect: z.object({ home: z.array(z.string()), intercept: z.array(z.string()) }).optional(),
  /** Its own statistics: lookups and blocked ones in its window (hours). */
  stats: z.object({ queries: z.number(), blocked: z.number(), hours: z.number(), avg_ms: z.number().nullish() }).nullish(),
  settings: z.array(settingSchema).optional(),
  networks: z.array(networkSchema).optional(),
  update: updateSchema.nullish(),
  licenses: z.object({ license: z.string(), notices: z.string().nullish() }).optional(),
});
export type AdGuardStatus = z.output<typeof statusSchema>;

export function getAdGuardStatus(): Promise<AdGuardStatus> {
  return call('milkflint.adguardhome', 'status', {}, statusSchema);
}

const rankedSchema = z.array(z.object({ name: z.string(), count: z.number() }));

const insightsSchema = z.object({
  running: z.boolean(),
  error: z.string().optional(),
  /** When the router read these from AdGuard Home (epoch seconds; it keeps them 15 s). */
  at: z.number().optional(),
  /** What each slot of the series is: an hour, or a day for a window of several days. */
  unit: z.enum(['hours', 'days']).optional(),
  /** Lookups per slot, oldest first; the last slot is the one going on now. */
  queries: z.array(z.number()).optional(),
  /** Of those, blocked (filters, safe browsing, parental control). */
  blocked: z.array(z.number()).optional(),
  total: z.number().optional(),
  total_blocked: z.number().optional(),
  /** Its top lists, most first, up to ten each: names asked for, names blocked, devices by address. */
  top_queried: rankedSchema.optional(),
  top_blocked: rankedSchema.optional(),
  top_clients: rankedSchema.optional(),
});
export type AdGuardInsights = z.output<typeof insightsSchema>;

/** What AdGuard Home is seeing: its top lists and lookups over its window, as its own dashboard shows them. */
export function getAdGuardInsights(): Promise<AdGuardInsights> {
  return call('milkflint.adguardhome', 'insights', {}, insightsSchema);
}

const resultSchema = z.object({
  ok: z.boolean().optional(),
  error: z.string().optional(),
  left: z.array(z.string()).optional(),
  token: z.string().optional(),
});

/** Single-use token exchange CGI (sets AdGuard Home's HttpOnly session cookie). */
export const OPEN_URL = '/cgi-bin/milkflint-adguardhome';

const errors: Record<string, string> = {
  not_installed: 'AdGuard Home isn’t in this firmware.',
  not_configured: 'Turn it on first: that writes its settings.',
  not_running: 'AdGuard Home isn’t running right now.',
  access_point: 'In access point mode the main router answers DNS.',
  router_login_off: 'Router sign-in is off: sign in at AdGuard Home with its own password.',
  login: 'The router couldn’t sign in to AdGuard Home.',
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

export type SetupChoice = { routerLogin: true } | { routerLogin: false; user: string; password: string };

/** The first time: writes its settings (with router login or its own user and password), then turns it on. */
export async function setupAdGuard(choice: SetupChoice): Promise<void> {
  await act(
    'setup',
    choice.routerLogin ? { router_login: true } : { router_login: false, user: choice.user, password: choice.password },
  );
}

export async function enableAdGuard(on: boolean): Promise<void> {
  await act('enable', { on });
}

/** What devices' lookups do while it isn't answering: answered unfiltered (true), or left to fail. */
export async function setFallback(on: boolean): Promise<void> {
  await act('fallback', { on });
}

/** Sets a separate AdGuard Home user name and password (turns router login off). */
export async function setCredentials(user: string, password: string): Promise<void> {
  await act('credentials', { user, password });
  await logoutAdGuard();
}

/** Switches to signing in through MilkFlint's router login (drops the separate password). */
export async function enableRouterLogin(): Promise<void> {
  await act('router_login', { on: true });
  await logoutAdGuard();
}

/** Exchanges the router's admin session for an HttpOnly AdGuard Home session cookie on this host. */
export async function openAdGuard(): Promise<void> {
  const r = await act('open', {});
  if (r.token === undefined || r.token === '') throw new Error(errors['login']);
  const res = await fetch(OPEN_URL, {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: r.token }),
  });
  if (!res.ok) throw new Error(errors['login']);
}

/** Clears AdGuard Home's browser session cookie and revokes it server-side (best-effort). */
export async function logoutAdGuard(): Promise<void> {
  await fetch(OPEN_URL, {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: '{"logout":true}',
  }).catch(() => undefined);
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
