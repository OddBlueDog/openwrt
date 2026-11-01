import { z } from 'zod';
import { call, UnreachableError } from '@/lib/ubus';

// The test bench's router side (source/feed/milkflint-ui/files/features/
// test-bench): milkflint.bench is the admin's, milkflint.bench.member a
// joined device's (called with the member's own session, which the join CGI
// hands out). Times are the router's monotonic clock in ms.

/** The router turned a call down: `message` is its reason, for showing. */
export class BenchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BenchError';
  }
}

const errorReply = z.object({ error: z.string() });
const orError = <S extends z.ZodType>(schema: S) => z.union([errorReply, schema]);

function ok<T extends object>(reply: T | { error: string }): T {
  if ('error' in reply && typeof reply.error === 'string') throw new BenchError(reply.error);
  return reply as T;
}

/** How a member is connected, as the router sees it (its station list, or the bridge port its address was seen on). */
const linkSchema = z
  .object({
    kind: z.enum(['wifi', 'wired']),
    mac: z.string().nullish(),
    dev: z.string().nullish(),
    ssid: z.string().nullish(),
    /** "2.4", "5" or "6" (GHz) */
    band: z.string().nullish(),
    channel: z.number().nullish(),
    /** channel width, MHz */
    width: z.number().nullish(),
    /** dBm */
    signal: z.number().nullish(),
    tx_mbit: z.number().nullish(),
    rx_mbit: z.number().nullish(),
    /** Wi-Fi 4 to 7, from the rate's modulation */
    generation: z.number().nullish(),
    /** a wired member's port (lan1) and its speed in Mbit/s */
    port: z.string().nullish(),
    speed: z.number().nullish(),
  })
  .loose();
export type Link = z.output<typeof linkSchema>;

/**
 * What a member measures right now: latency to the router (r), the
 * internet (w) and its device-to-device partners (p), ms; download (d),
 * upload (u) and data from partners (x), Mbit/s; partners connected (o) of
 * those the run pairs it with (k); its last page loads (g) and lookups of
 * made-up names (l), ms.
 */
const liveSchema = z.object({
  r: z.number().optional(),
  w: z.number().optional(),
  d: z.number().optional(),
  u: z.number().optional(),
  p: z.number().optional(),
  x: z.number().optional(),
  o: z.number().optional(),
  k: z.number().optional(),
  g: z.number().optional(),
  l: z.number().optional(),
});
export type LiveFigures = z.output<typeof liveSchema>;

const memberSchema = z.object({
  id: z.string(),
  name: z.string(),
  ip: z.string(),
  ua: z.string().nullish(),
  platform: z.string().nullish(),
  link: linkSchema.nullish(),
  /** since the member's last call */
  seen_ms: z.number(),
  visible: z.boolean().nullish(),
  /** how far its clock sync may be off, µs */
  clock_us: z.number().nullish(),
  /** the phase it's in (-1: none) and what it says it's doing */
  phase: z.number().nullish(),
  note: z.string().nullish(),
  joined: z.number(),
  live: liveSchema.nullish(),
});
export type Member = z.output<typeof memberSchema>;

export const phaseKinds = ['idle', 'wan_down', 'wan_up', 'wan_both', 'connect', 'd2d', 'dns', 'household', 'cooldown'] as const;
export type PhaseKind = (typeof phaseKinds)[number];

const phaseSchema = z.object({
  kind: z.enum(phaseKinds),
  /** from the run's start, ms */
  start: z.number(),
  dur: z.number(),
  label: z.string().nullish(),
  /** member id -> its part ('down', 'up', 'a', 'b', 'dns', ...); members not named only probe */
  roles: z.record(z.string(), z.string()).catch({}),
  streams: z.number().nullish(),
  pair: z.tuple([z.string(), z.string()]).nullish(),
  dir: z.enum(['ab', 'ba', 'both']).nullish(),
});
export type Phase = z.output<typeof phaseSchema>;

export const optionsSchema = z.object({
  /** where members' internet loads go: Cloudflare's speed test, or the UI's dev server */
  endpoint: z.enum(['cloudflare', 'dev']).catch('cloudflare'),
  /** the internet host members and the router measure latency to */
  latency: z.enum(['uk', 'eu', 'us']).catch('uk'),
  /** the most a member's loads may move in the run, MB */
  budget_mb: z.number().catch(2000),
  /** sites for DNS and page loads besides the fixed list (pages.ts) */
  custom_sites: z.array(z.string()).catch([]).default([]),
});
export type Options = z.output<typeof optionsSchema>;

export const scheduleSchema = z.object({
  name: z.string().nullish(),
  /** a rehearsal: members only mark when each phase starts */
  dry: z.boolean(),
  phases: z.array(phaseSchema),
  /** ms */
  length: z.number(),
  options: optionsSchema.catch({ endpoint: 'cloudflare', latency: 'uk', budget_mb: 2000, custom_sites: [] }),
});
export type Schedule = z.output<typeof scheduleSchema>;

/** The router's last second of a run, in short (bench-runner's live.json). */
const routerLiveSchema = z.object({
  t: z.number(),
  /** per CPU: [busy, softirq], shares of its time */
  cpu: z.array(z.tuple([z.number(), z.number()]).nullable()).catch([]),
  /** the recorder's, the prober's and bench-dns's own CPU, shares of one */
  self: z.array(z.number()).nullish(),
  /** the WAN port's bit/s: [in, out] */
  wan: z.tuple([z.number(), z.number()]).nullish(),
  /** Smart Queue's busiest tin, download and upload: [average, peak] delay, µs */
  down: z.tuple([z.number(), z.number()]).nullish(),
  up: z.tuple([z.number(), z.number()]).nullish(),
  /** connections offloaded, of all tracked */
  off: z.tuple([z.number(), z.number()]).nullish(),
});
export type RouterLive = z.output<typeof routerLiveSchema>;

export const runStates = ['scheduled', 'running', 'stopping', 'collecting', 'done'] as const;
export type RunState = (typeof runStates)[number];

const runSchema = z.object({
  id: z.string(),
  state: z.enum(runStates),
  t0: z.number(),
  end: z.number(),
  started_by: z.string().nullish(),
  stop: z.object({ by: z.string(), at: z.number() }).nullish(),
  ended: z.object({ reason: z.string(), at: z.number(), by: z.string().nullish() }).nullish(),
  /** only when the poll asked for it (a run it hadn't seen) */
  schedule: scheduleSchema.nullish(),
  /** while it runs: the router's last second, and its pings' */
  live: z
    .object({
      router: routerLiveSchema.nullish(),
      /** target (a member's id, 'wan', 'far') -> [median ms, lost, sent] */
      probes: z.record(z.string(), z.unknown()).nullish(),
    })
    .nullish(),
});
export type Run = z.output<typeof runSchema>;

const signalSchema = z.object({
  n: z.number(),
  from: z.string(),
  pair: z.string(),
  kind: z.enum(['offer', 'answer', 'bye']),
  sdp: z.string().nullish(),
});
export type Signal = z.output<typeof signalSchema>;

const benchSchema = z.object({
  id: z.string(),
  name: z.string(),
  opened: z.number(),
  /** when it closes unless it's used */
  closes: z.number(),
  token: z.string(),
  code: z.string(),
  /** too many wrong codes: only the QR code works until a new code */
  code_disabled: z.boolean(),
  coordinator: z.string().nullish(),
  members: z.array(memberSchema),
  run: runSchema.nullish(),
});
export type Bench = z.output<typeof benchSchema>;

const adminViewSchema = z.object({ now: z.number(), bench: benchSchema.nullable() });
export type AdminView = z.output<typeof adminViewSchema>;

const pollSchema = z.object({
  now: z.number(),
  me: z.string(),
  bench: z.object({
    id: z.string(),
    name: z.string(),
    coordinator: z.string().nullish(),
    /** the join token and code: only for the coordinator */
    token: z.string().nullish(),
    code: z.string().nullish(),
    code_disabled: z.boolean().nullish(),
    /** Smart Queue's shaped rates, kbit/s (null: it's off) */
    shaper: z.object({ interface: z.string().nullish(), down_kbit: z.number(), up_kbit: z.number(), qdisc: z.string().nullish() }).nullish(),
  }),
  members: z.array(memberSchema),
  run: runSchema.nullish(),
  signals: z.array(signalSchema).catch([]),
});
export type Poll = z.output<typeof pollSchema>;

const runSummarySchema = z.object({
  id: z.string(),
  bench: z.string().nullish(),
  plan: z.string().nullish(),
  dry: z.boolean().nullish(),
  /** epoch seconds */
  created_wall: z.number(),
  length: z.number().nullish(),
  members: z.array(z.string()).catch([]),
  ended: z.string().nullish(),
  bytes: z.number(),
  current: z.boolean(),
});
export type RunSummary = z.output<typeof runSummarySchema>;

/** A stored run's member, as it was when the run started. */
export const runMemberSchema = z.object({
  id: z.string(),
  name: z.string(),
  ip: z.string(),
  ua: z.string().nullish(),
  platform: z.string().nullish(),
  link: linkSchema.nullish(),
});

export type RunMember = z.output<typeof runMemberSchema>;

/** What a run was measured against, as configured when it started (read only). */
export const runSettingsSchema = z
  .object({
    sqm: z
      .array(
        z
          .object({
            interface: z.string().nullish(),
            enabled: z.string().nullish(),
            /** kbit/s */
            download: z.number().nullish(),
            upload: z.number().nullish(),
            qdisc: z.string().nullish(),
            script: z.string().nullish(),
            use_mq: z.string().nullish(),
            linklayer: z.string().nullish(),
            overhead: z.union([z.string(), z.number()]).nullish(),
          })
          .loose(),
      )
      .catch([]),
    firewall: z
      .object({ flow_offloading: z.string().nullish(), flow_offloading_hw: z.string().nullish(), flow_offloading_bridge: z.string().nullish() })
      .loose()
      .catch({}),
    wifi: z
      .array(
        z
          .object({ radio: z.string().nullish(), band: z.string().nullish(), channel: z.union([z.string(), z.number()]).nullish(), htmode: z.string().nullish(), disabled: z.string().nullish() })
          .loose(),
      )
      .catch([]),
    dns: z.string().nullish(),
    firmware: z.string().nullish(),
    model: z.string().nullish(),
  })
  .loose()
  .catch({ sqm: [], firewall: {}, wifi: [] });
export type RunSettings = z.output<typeof runSettingsSchema>;

export const runEndSchema = z.object({ reason: z.string(), at: z.number(), by: z.string().nullish() });
export type RunEnd = z.output<typeof runEndSchema>;

export const storedRunSchema = z.object({
  id: z.string(),
  bench: z.string(),
  bench_name: z.string().nullish(),
  created: z.number(),
  /** epoch seconds */
  created_wall: z.number(),
  t0: z.number(),
  end: z.number(),
  schedule: scheduleSchema,
  members: z.array(runMemberSchema),
  coordinator: z.string().nullish(),
  settings: runSettingsSchema,
});
export type StoredRun = z.output<typeof storedRunSchema>;

const runMetaSchema = z.object({
  meta: storedRunSchema.nullable(),
  end: runEndSchema.nullable(),
  state: z.enum(runStates),
  now: z.number(),
});
export type RunMeta = z.output<typeof runMetaSchema>;

/** A page of a stored run's part: its lines (JSON each), and where the next page starts. */
const pageSchema = z.object({ lines: z.array(z.string()).catch([]), next: z.number().nullable() });
export type RunPage = z.output<typeof pageSchema>;

// ---- The admin's ----

export async function getStatus(): Promise<AdminView> {
  return ok(await call('milkflint.bench', 'status', {}, orError(adminViewSchema)));
}

export async function openBench(name: string, replace: boolean): Promise<AdminView> {
  return ok(await call('milkflint.bench', 'create', { name, replace }, orError(adminViewSchema)));
}

export async function closeBench(): Promise<void> {
  ok(await call('milkflint.bench', 'close', {}, orError(z.object({ closed: z.boolean() }))));
}

export async function newCode(): Promise<AdminView> {
  return ok(await call('milkflint.bench', 'rotate', {}, orError(adminViewSchema)));
}

export async function coordinate(member: string): Promise<AdminView> {
  return ok(await call('milkflint.bench', 'coordinate', { member }, orError(adminViewSchema)));
}

export async function getRuns(): Promise<RunSummary[]> {
  return ok(await call('milkflint.bench', 'runs', {}, orError(z.object({ runs: z.array(runSummarySchema) })))).runs;
}

export async function getRunMeta(run: string): Promise<RunMeta> {
  return ok(await call('milkflint.bench', 'run_get', { run, part: 'meta', from: 0 }, orError(runMetaSchema)));
}

export async function getRunPage(run: string, part: string, from: number): Promise<RunPage> {
  return ok(await call('milkflint.bench', 'run_get', { run, part, from }, orError(pageSchema)));
}

export async function deleteRun(run: string): Promise<void> {
  ok(await call('milkflint.bench', 'run_delete', { run }, orError(z.object({ deleted: z.boolean() }))));
}

// ---- A member's (with its own session) ----

/** The router's clock now. */
export async function sync(session: string): Promise<number> {
  return ok(await call('milkflint.bench.member', 'sync', {}, orError(z.object({ now: z.number() })), { session })).now;
}

export interface PollArgs {
  /** the run whose schedule the member has already */
  run: string;
  /** the last signal it has */
  signals: number;
  visible: boolean;
  clockUs: number;
  phase: number;
  note: string;
  /** what it measures right now (see Member.live) */
  live: LiveFigures;
}

export async function poll(session: string, a: PollArgs): Promise<Poll> {
  const args = { run: a.run, signals: a.signals, visible: a.visible, clock_us: Math.round(a.clockUs), phase: a.phase, note: a.note, live: a.live };
  return ok(await call('milkflint.bench.member', 'poll', args, orError(pollSchema), { session }));
}

/** `member`: another member's (the coordinator can rename anyone). */
export async function rename(session: string, name: string, member?: string): Promise<string> {
  const args = member === undefined ? { name } : { name, member };
  return ok(await call('milkflint.bench.member', 'rename', args, orError(z.object({ name: z.string() })), { session })).name;
}

/** One report of results (at most 32 KB of JSON); false: a repeat the router already has. */
export async function report(session: string, run: string, seq: number, records: unknown[]): Promise<boolean> {
  return ok(await call('milkflint.bench.member', 'report', { run, seq, records }, orError(z.object({ stored: z.boolean() })), { session }))
    .stored;
}

export async function sendSignal(session: string, to: string, pair: string, kind: Signal['kind'], sdp?: string): Promise<void> {
  const args = sdp === undefined ? { to, pair, kind } : { to, pair, kind, sdp };
  ok(await call('milkflint.bench.member', 'signal', args, orError(z.object({ sent: z.number() })), { session }));
}

export async function stopRun(session: string): Promise<boolean> {
  return ok(await call('milkflint.bench.member', 'stop', {}, orError(z.object({ stopping: z.boolean() })), { session })).stopping;
}

export async function leave(session: string): Promise<void> {
  ok(await call('milkflint.bench.member', 'leave', {}, orError(z.object({ left: z.boolean() })), { session }));
}

export async function memberRuns(session: string): Promise<RunSummary[]> {
  return ok(await call('milkflint.bench.member', 'runs', {}, orError(z.object({ runs: z.array(runSummarySchema) })), { session })).runs;
}

export async function memberRunMeta(session: string, run: string): Promise<RunMeta> {
  return ok(await call('milkflint.bench.member', 'run_get', { run, part: 'meta', from: 0 }, orError(runMetaSchema), { session }));
}

export async function memberRunPage(session: string, run: string, part: string, from: number): Promise<RunPage> {
  return ok(await call('milkflint.bench.member', 'run_get', { run, part, from }, orError(pageSchema), { session }));
}

/** The schedule as plans.ts builds it, before the router checks it. */
export type ScheduleRequest = Omit<Schedule, 'length' | 'options'> & { options: z.input<typeof optionsSchema> };

/** Start a run (the coordinator): it begins a few seconds from now, at `t0`. */
export async function startRun(session: string, schedule: ScheduleRequest): Promise<{ run: string; t0: number }> {
  return ok(await call('milkflint.bench.member', 'start', { schedule }, orError(z.object({ run: z.string(), t0: z.number() })), { session }));
}

export async function handoff(session: string, member: string): Promise<void> {
  ok(await call('milkflint.bench.member', 'handoff', { member }, orError(z.object({ coordinator: z.string() })), { session }));
}

export async function kick(session: string, member: string): Promise<void> {
  ok(await call('milkflint.bench.member', 'kick', { member }, orError(z.object({ kicked: z.string() })), { session }));
}

// ---- Joining (the join CGI, not ubus) ----

export const JOIN_URL = '/cgi-bin/milkflint-test-bench';

const joinedSchema = z.object({ sid: z.string().length(32), member: z.string(), key: z.string(), bench: z.string(), name: z.string() });
export type Joined = z.output<typeof joinedSchema>;

/** What a device joins with: the QR code's token, the typed code, or its own key to join again. */
export type JoinWith = { token: string } | { code: string } | { member: string; key: string };

export async function join(how: JoinWith, name?: string, platform?: string): Promise<Joined> {
  const body: Record<string, string> = { ...how };
  if (name !== undefined) body['name'] = name;
  if (platform !== undefined) body['platform'] = platform;
  let res: Response;
  try {
    res = await fetch(JOIN_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store' });
  } catch (err) {
    throw new UnreachableError(err);
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new BenchError(`the router answered ${String(res.status)}`);
  }
  return ok(orError(joinedSchema).parse(data));
}
