import { z } from 'zod';
import { call } from '@/lib/ubus';
import type { Options } from './options';

const nullableNumber = z.number().nullish();

const runSchema = z.object({
  action: z.string().nullish(),
  started: nullableNumber,
  stage: z.string().nullish(),
  finished: nullableNumber,
  ok: z.boolean().nullish(),
  error: z.string().nullish(),
  /** each set (or feed) that failed this run, and how: download, empty, load, failed, … */
  results: z.record(z.string(), z.string()).nullish(),
  /** while running: lists done of those to do */
  done: nullableNumber,
  expected: nullableNumber,
});
export type Run = z.output<typeof runSchema>;

export const STATES = ['off', 'ap', 'updating', 'protecting', 'error', 'stopped'] as const;
export type State = (typeof STATES)[number];

const statusSchema = z.object({
  installed: z.boolean(),
  version: z.string().nullish(),
  /** the license texts this image carries, as links (none on images before they were added) */
  licenses: z.object({ banip: z.string().nullish(), gawk: z.string().nullish() }).nullish(),
  enabled: z.boolean().optional(),
  mode: z.enum(['router', 'ap']).optional(),
  state: z.enum(STATES).optional(),
  reason: z.string().nullish(),
  /** banIP's table is loaded */
  table: z.boolean().optional(),
  service: z.boolean().optional(),
  monitor: z.boolean().optional(),
  elements: nullableNumber,
  feeds: z.array(z.string()).optional(),
  countries: z.array(z.string()).optional(),
  run: runSchema.nullish(),
  last: runSchema.nullish(),
  last_run: z
    .object({ mode: z.string().nullish(), at: z.string().nullish(), duration: nullableNumber, memory: z.string().nullish() })
    .nullish(),
  schedule: z.object({ schedule: z.string(), time: z.string(), day: z.number(), next: nullableNumber }).optional(),
  counting: z.boolean().optional(),
  logging: z.object({ inbound: z.boolean(), outbound: z.boolean() }).optional(),
  drops: z
    .object({
      step: z.number(),
      /** the newest slot's start (epoch seconds) */
      end: nullableNumber,
      counted: z.array(z.number()),
      logged: z.array(z.number()),
      flood: z.array(z.number()),
      hour: z.number(),
      day: z.number(),
      source: z.enum(['counters', 'log']),
    })
    .optional(),
  autoblocked: z.number().optional(),
  memory: z.object({ total_kb: z.number(), available_kb: z.number() }).optional(),
  now: z.number().optional(),
});
export type BanipStatus = z.output<typeof statusSchema>;

export function getStatus(): Promise<BanipStatus> {
  return call('milkflint.banip', 'status', {}, statusSchema);
}

const optionValue = z.union([z.string(), z.array(z.string())]).nullable();

const feedSchema = z.object({
  name: z.string(),
  url_4: z.string().nullish(),
  url_6: z.string().nullish(),
  rule: z.string().nullish(),
  chain: z.string().nullish(),
  flag: z.string().nullish(),
  descr: z.string().nullish(),
  builtin: z.boolean(),
  own: z.boolean(),
  changed: z.boolean(),
});
export type Feed = z.output<typeof feedSchema>;

const metaSchema = z.object({
  bytes: z.object({
    kept: z.number(),
    copy: z.number().optional(),
    counter_base: z.number(),
    counter_per_cpu: z.number(),
    load: z.number(),
    load_base: z.number(),
    run: z.number(),
  }),
  asn_entries: z.number(),
  unknown_entries: z.number(),
  feeds: z.record(z.string(), z.object({ v4: z.number().optional(), v6: z.number().optional(), kb: z.number().optional() })),
  countries: z.record(z.string(), z.object({ v4: z.number().optional(), v6: z.number().optional() })),
});
export type Meta = z.output<typeof metaSchema>;

const runtimeSchema = z
  .object({
    status: z.string().nullish(),
    version: z.string().nullish(),
    counts: z.object({ elements: z.number(), chains: z.number(), sets: z.number(), rules: z.number() }).nullish(),
    sets: z.array(z.string()),
    devices: z.array(z.string()),
    interfaces: z.array(z.string()),
    triggers: z.array(z.string()),
    vlan_allow: z.array(z.string()),
    vlan_block: z.array(z.string()),
    uplink: z.array(z.string()),
    nft: z.record(z.string(), z.string().nullish()),
    flags: z.string().nullish(),
    dirs: z.string().nullish(),
    system: z.object({ cores: z.number(), log: z.string().nullish(), fetch: z.string().nullish() }),
  })
  .nullish();
export type Runtime = z.output<typeof runtimeSchema>;

const installSchema = z
  .object({
    busy: z.boolean(),
    package: z.string().nullish(),
    ok: z.boolean().nullish(),
    log: z.string().nullish(),
    started: nullableNumber,
    finished: nullableNumber,
  })
  .nullish();

const configSchema = z.object({
  installed: z.boolean(),
  options: z.record(z.string(), optionValue).optional(),
  milkflint: z.record(z.string(), z.string()).optional(),
  managed: z.object({ ports: z.array(z.string()), udp: z.boolean(), wireguard: z.array(z.string()) }).optional(),
  catalogue: z.array(feedSchema).optional(),
  /** builtin: banIP's own catalogue; ours: the page's feeds added to it; edited: the custom feed file was changed elsewhere */
  custom: z.object({ state: z.enum(['builtin', 'ours', 'edited']), loads: z.boolean(), own: z.array(z.string()) }).optional(),
  countries: z.array(z.object({ code: z.string(), region: z.string(), name: z.string() })).optional(),
  meta: metaSchema.optional(),
  /** entries per set, from banIP's last report */
  known: z.record(z.string(), z.number()).optional(),
  memory: z.object({ total_kb: z.number(), available_kb: z.number() }).optional(),
  cpus: z.number().optional(),
  runtime: runtimeSchema,
  wifi_country: z.string().nullish(),
  inside: z.array(z.object({ iface: z.string(), zone: z.string(), net: z.string() })).optional(),
  tools: z.object({ msmtp: z.boolean(), conntrack: z.boolean(), curl: z.boolean(), wget: z.boolean() }).optional(),
  install: installSchema,
  cgi: z.boolean().optional(),
  mode: z.enum(['router', 'ap']).optional(),
  enabled: z.boolean().optional(),
});
export type BanipConfig = z.output<typeof configSchema>;

export function getConfig(): Promise<BanipConfig> {
  return call('milkflint.banip', 'config', {}, configSchema);
}

// ---- answers and their errors ----------------------------------------------------

const problemSchema = z.object({
  field: z.string().optional(),
  reason: z.string().optional(),
  line: z.number().nullish(),
  text: z.string().optional(),
});
const lockoutSchema = z.object({
  entry: z.string(),
  line: z.number().nullish(),
  what: z.string(),
  name: z.string().nullish(),
  address: z.string().nullish(),
});
export type Lockout = z.output<typeof lockoutSchema>;

const memorySchema = z.object({
  total_kb: z.number(),
  available_kb: z.number(),
  reserve_kb: z.number(),
  freed_kb: z.number(),
  left_kb: z.number(),
  ok: z.boolean(),
  kept_kb: z.number().optional(),
  load_kb: z.number().optional(),
  entries: z.number().optional(),
});

const resultSchema = z
  .object({
    ok: z.boolean().optional(),
    error: z.string().optional(),
    problems: z.array(problemSchema).optional(),
    lockouts: z.array(lockoutSchema).optional(),
    memory: memorySchema.nullish(),
    action: z.string().nullish(),
    applied: z.boolean().optional(),
    /** with big lists loaded, the change goes into the loaded sets in the background (seconds) */
    pending: z.boolean().optional(),
    added: z.number().optional(),
    removed: z.number().optional(),
    failed: z.number().optional(),
    still: z.array(z.string()).optional(),
    removed_lines: z.array(z.string()).optional(),
    removed_element: z.string().nullish(),
    imported: z.array(z.string()).optional(),
    ended: z.number().optional(),
    count: z.number().optional(),
  })
  .loose();
export type Result = z.output<typeof resultSchema>;

const LOCKOUT_WHAT: Record<string, string> = {
  browser: 'this device (it has these pages open)',
  inside: 'your own network',
  wan: 'the router’s own internet address',
  gateway: 'your internet provider’s gateway',
  dns: 'a DNS server the router uses',
  ntp: 'a time server the router uses',
  feed: 'MilkFlint’s package server',
};

export function lockoutText(l: Lockout): string {
  return `${l.entry} would block ${LOCKOUT_WHAT[l.what] ?? l.what}${l.name !== null && l.name !== undefined && l.name !== l.entry ? ` (${l.name})` : ''}.`;
}

const REASONS: Record<string, string> = {
  not_installed: 'banIP isn’t in this firmware.',
  access_point: 'In access point mode the main router faces the internet, so banIP stays off here.',
  off: 'Turn banIP on first.',
  allowlist_empty: 'Add what devices may reach to the allowlist first: allowlist-only mode blocks everything else.',
  edited:
    'The custom feed file was changed outside this page. Take it over or go back to banIP’s catalogue first (Advanced, Downloads).',
  no_conntrack: 'Ending open connections needs conntrack, which isn’t installed.',
  no_msmtp: 'Mail needs msmtp, which isn’t installed.',
  no_receiver: 'Set the address to send to first.',
  busy: 'An install is running already.',
  write: 'The router couldn’t write the file.',
  lookup: 'The registry didn’t answer.',
  internal: 'The router hit an error doing that; it’s in the system log.',
};

const FIELD_REASONS: Record<string, string> = {
  range: 'out of range',
  format: 'not in the right form',
  value: 'not one of the choices',
  item: 'an entry isn’t in the right form',
  feed: 'a list that isn’t in the catalogue',
  country: 'a country banIP doesn’t know',
  duplicate: 'an entry is there twice',
  regex: 'not a valid pattern',
  not_settable: 'not set here',
  path: 'not a full path',
  type: 'the wrong kind of value',
};

/** Thrown for an answer with error: its words, and the details for the page. */
export class BanipError extends Error {
  readonly result: Result;
  constructor(message: string, result: Result) {
    super(message);
    this.result = result;
  }
}

export function errorText(r: Result): string {
  if (r.error === 'lockout' && r.lockouts !== undefined) return `Refused: ${r.lockouts.map(lockoutText).join(' ')}`;
  if (r.error === 'memory' && r.memory !== undefined && r.memory !== null) {
    const need = Math.round(((r.memory.kept_kb ?? 0) + (r.memory.load_kb ?? 0)) / 1024);
    const free = Math.round((r.memory.available_kb + r.memory.freed_kb - r.memory.reserve_kb) / 1024);
    return `Refused: these lists need about ${String(need)} MB while they load, and the router can spare about ${String(Math.max(0, free))} MB. Choose fewer, or a smaller split size (Advanced, Firewall).`;
  }
  if (r.error === 'invalid' && r.problems !== undefined) {
    const p = r.problems
      .slice(0, 3)
      .map((x) =>
        x.line !== undefined && x.line !== null
          ? `line ${String(x.line)} (${x.text ?? ''})`
          : `${x.field ?? ''}: ${FIELD_REASONS[x.reason ?? ''] ?? x.reason ?? ''}`,
      );
    return `Not saved: ${p.join('; ')}${r.problems.length > 3 ? '…' : ''}.`;
  }
  return REASONS[r.error ?? ''] ?? `The router couldn’t: ${r.error ?? 'unknown error'}.`;
}

async function act(method: string, params: Record<string, unknown>): Promise<Result> {
  const r = await call('milkflint.banip', method, params, resultSchema);
  if (r.error !== undefined) throw new BanipError(errorText(r), r);
  return r;
}

/** Saves options (only those given; null unsets) and MilkFlint's banIP settings. */
export function saveOptions(options: Options, milkflint: Record<string, string> = {}): Promise<Result> {
  return act('set', { options, milkflint });
}

export function enableBanip(on: boolean): Promise<Result> {
  return act('enable', { on });
}

/** reload: download every list again ("Update lists now"); restart: rebuild from the backups; report: recount */
export function runAction(name: 'reload' | 'restart' | 'report'): Promise<Result> {
  return act('action', { name });
}

export type ListName = 'allowlist' | 'blocklist';

const listSchema = z.object({
  ok: z.boolean().optional(),
  error: z.string().optional(),
  text: z.string().optional(),
  size: z.number().optional(),
  too_big: z.boolean().optional(),
});

export async function getList(list: ListName): Promise<{ text: string; size: number; tooBig: boolean }> {
  const r = await call('milkflint.banip', 'list_get', { list }, listSchema);
  if (r.error !== undefined) throw new Error(errorText(r));
  return { text: r.text ?? '', size: r.size ?? 0, tooBig: r.too_big === true };
}

export function saveList(list: ListName, text: string): Promise<Result> {
  return act('list_set', { list, text });
}

export function listEntry(list: ListName, op: 'add' | 'remove', value: string, comment = ''): Promise<Result> {
  return act('entry', { list, op, value, comment });
}

export function unblock(address: string): Promise<Result> {
  return act('unblock', { address });
}

export function allowAddress(address: string, comment = ''): Promise<Result> {
  return act('allow', { address, comment });
}

export function endConnections(address: string): Promise<Result> {
  return act('flush', { address });
}

// ---- looking things up ---------------------------------------------------------------

const lineSchema = z.object({ line: z.number().nullish(), value: z.string(), comment: z.string().nullish() });
const hitSchema = z.object({
  set: z.string(),
  feed: z.string(),
  element: z.string(),
  packets: nullableNumber,
  expires: z.string().nullish(),
  inbound: z.boolean(),
  outbound: z.boolean(),
  ports: z.string().nullish(),
  verdict: z.string().nullish(),
});
export type SetHit = z.output<typeof hitSchema>;

const searchSchema = z.object({
  ok: z.boolean().optional(),
  error: z.string().optional(),
  query: z.string().optional(),
  kind: z.string().optional(),
  resolved: z.array(z.string()).nullish(),
  results: z
    .array(
      z.object({ address: z.string(), sets: z.array(hitSchema), allowlist: z.array(lineSchema), blocklist: z.array(lineSchema) }),
    )
    .optional(),
  allowlist: z.array(lineSchema).optional(),
  blocklist: z.array(lineSchema).optional(),
  loaded: z.boolean().optional(),
  /** banIP's lists changed in their last update and are being copied again: their part may be out of date */
  stale: z.boolean().optional(),
});
export type Search = z.output<typeof searchSchema>;

export async function search(query: string): Promise<Search> {
  const r = await call('milkflint.banip', 'search', { query }, searchSchema);
  if (r.error !== undefined)
    throw new Error(
      r.error === 'query' ? 'Type an address (IPv4 or IPv6), a network, a MAC address or a domain name.' : errorText(r),
    );
  return r;
}

const lookupSchema = z.object({
  ok: z.boolean().optional(),
  error: z.string().optional(),
  address: z.string().optional(),
  network: z.string().nullish(),
  name: z.string().nullish(),
  country: z.string().nullish(),
  org: z.string().nullish(),
  registry: z.string().nullish(),
});
export type Registry = z.output<typeof lookupSchema>;

/** Who an address belongs to, from its registry (RDAP), asked by the router. */
export async function registryOf(address: string): Promise<Registry> {
  const r = await call('milkflint.banip', 'lookup', { address }, lookupSchema);
  if (r.error !== undefined) throw new Error(errorText(r));
  return r;
}

const surveySchema = z.object({
  ok: z.boolean().optional(),
  error: z.string().optional(),
  set: z.string().optional(),
  total: z.number().optional(),
  matched: z.number().optional(),
  offset: z.number().optional(),
  elements: z.array(z.object({ value: z.string(), packets: nullableNumber, expires: z.string().nullish() })).optional(),
  listed: nullableNumber,
});
export type Survey = z.output<typeof surveySchema>;

export async function survey(set: string, offset: number, limit: number, filter: string, hits: boolean): Promise<Survey> {
  const r = await call('milkflint.banip', 'survey', { set, offset, limit, filter, hits, fresh: false }, surveySchema);
  if (r.error !== undefined) throw new Error(r.error === 'no_set' ? 'That list isn’t loaded now.' : errorText(r));
  return r;
}

const reportSetSchema = z.object({
  elements: nullableNumber,
  inbound: z.boolean(),
  outbound: z.boolean(),
  in_packets: nullableNumber,
  out_packets: nullableNumber,
  ports: z.string().nullish(),
  top: z.array(z.string()),
});
export type ReportSet = z.output<typeof reportSetSchema>;

const reportSchema = z.object({
  ok: z.boolean().optional(),
  timestamp: z.string().nullish(),
  generated: nullableNumber,
  autoadd: z.object({ allow: z.number(), block: z.number() }).nullish(),
  sets: z.record(z.string(), reportSetSchema),
  flood: z.record(z.string(), z.number()).nullish(),
  counting: z.boolean(),
});
export type Report = z.output<typeof reportSchema>;

export function getReport(refresh = false): Promise<Report> {
  return call('milkflint.banip', 'report', { refresh }, reportSchema);
}

const dropSchema = z.object({
  t: z.number(),
  dir: z.string(),
  kind: z.string(),
  policy: z.string(),
  set: z.string(),
  in: z.string(),
  out: z.string(),
  src: z.string(),
  dst: z.string(),
  proto: z.string(),
  sport: z.string(),
  dport: z.string(),
  mac: z.string(),
});
export type Drop = z.output<typeof dropSchema>;

const topSchema = z.array(z.object({ key: z.string(), count: z.number() }));
const dropsSchema = z.object({
  ok: z.boolean().optional(),
  error: z.string().optional(),
  total: z.number(),
  offset: z.number(),
  rows: z.array(dropSchema),
  top: z.object({
    sources: topSchema,
    devices: topSchema,
    ports: topSchema,
    sets: topSchema,
    directions: z.record(z.string(), z.number()),
  }),
  first: nullableNumber,
  events: z.array(z.object({ t: z.number(), kind: z.string(), address: z.string(), set: z.string(), detail: z.string() })),
});
export type Drops = z.output<typeof dropsSchema>;

export interface DropFilter {
  dir?: string;
  set?: string;
  address?: string;
  port?: string;
  proto?: string;
}

export function getDrops(offset: number, limit: number, filter: DropFilter): Promise<Drops> {
  return call('milkflint.banip', 'drops', { offset, limit, filter }, dropsSchema);
}

const logSchema = z.object({ ok: z.boolean().optional(), lines: z.array(z.string()), truncated: z.boolean().optional() });

/** banIP's own lines in the system log */
export function getProcessingLog(lines = 300): Promise<z.output<typeof logSchema>> {
  return call('milkflint.banip', 'log', { lines }, logSchema);
}

// ---- the page's own feeds --------------------------------------------------------------

export interface FeedDefinition {
  url_4?: string;
  url_6?: string;
  rule: string;
  chain: 'in' | 'out' | 'inout';
  descr: string;
  flag?: string;
}

export function saveFeed(name: string, feed: FeedDefinition): Promise<Result> {
  return act('feed', { op: 'set', name, feed, text: '' });
}

export function removeFeed(name: string): Promise<Result> {
  return act('feed', { op: 'remove', name, feed: {}, text: '' });
}

export function importFeeds(text: string): Promise<Result> {
  return act('feed', { op: 'import', name: '', feed: {}, text });
}

/** the custom feed file edited elsewhere becomes the page's, or the page's feeds go (banIP's catalogue again) */
export function customFile(op: 'adopt' | 'reset'): Promise<Result> {
  return act('feed', { op, name: '', feed: {}, text: '' });
}

const feedTestSchema = z.object({
  ok: z.boolean().optional(),
  error: z.string().optional(),
  field: z.string().optional(),
  reachable: z.boolean().optional(),
  bytes: z.number().optional(),
  truncated: z.boolean().optional(),
  v4: z.number().optional(),
  v6: z.number().optional(),
  sample: z.array(z.string()).optional(),
});
export type FeedTest = z.output<typeof feedTestSchema>;

export function testFeed(url: string, rule: string, flag: string): Promise<FeedTest> {
  return call('milkflint.banip', 'feed_test', { url, rule, flag }, feedTestSchema);
}

// ---- packages and mail -----------------------------------------------------------------

export function installPackage(pkg: 'msmtp' | 'conntrack'): Promise<Result> {
  return act('install', { package: pkg });
}

const mailSchema = z.object({
  ok: z.boolean().optional(),
  installed: z.boolean(),
  profile: z.string(),
  account: z.string().nullish(),
  host: z.string().nullish(),
  port: z.number().nullish(),
  tls: z.enum(['starttls', 'tls', 'off']).nullish(),
  user: z.string().nullish(),
  from: z.string().nullish(),
  password: z.boolean(),
  elsewhere: z.boolean(),
});
export type MailAccount = z.output<typeof mailSchema>;

export function getMail(): Promise<MailAccount> {
  return call('milkflint.banip', 'mail_get', {}, mailSchema);
}

export interface MailSettings {
  host: string;
  port: number;
  tls: 'starttls' | 'tls' | 'off';
  user: string;
  /** empty: keep the one saved */
  password: string;
  from: string;
}

export function saveMail(m: MailSettings): Promise<Result> {
  return act('mail_set', { host: m.host, port: m.port, tls: m.tls, user: m.user, password: m.password, from: m.from });
}

export function testMail(): Promise<Result> {
  return act('mail_test', {});
}
