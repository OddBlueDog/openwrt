// A run as one JSON file (format milkflint-bench/1): what it was (the plan,
// the members as they joined, the router and its settings), everything the
// devices and the router recorded, the figures the report shows, and the
// checks with the thresholds that gave them. It has no public addresses:
// any in its text (a browser's error message, a member that joined over a
// global IPv6 address) is replaced by "hidden". A file can be opened again
// in the report.
import { z } from 'zod';
import {
  memberRtts,
  memberThroughput,
  parseProbes,
  parseRouter,
  routerRtts,
  routerWindow,
  type RouterWindow,
  type RttStats,
  rttStats,
  runWindows,
  type Throughput,
} from './analysis';
import { runEndSchema, storedRunSchema } from './api';
import { type Check, parseThresholds, type Thresholds } from './checks';
import { parseDns } from './dns-pages';
import { latencyRows, type LatencyTarget } from './latency';
import type { RunRecord } from './member';
import { memberPeerRtts } from './pairs';
import { reportRun, type RunData } from './run-data';
import { isRecord } from './timing';

export const EXPORT_FORMAT = 'milkflint-bench/1';

// ---- Public addresses ----

function privateV4(parts: readonly number[]): boolean {
  const [a = 0, b = 0] = parts;
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || parts.every((p) => p === 0);
}

/** An IPv6 address, written in full or with "::" once. */
function isV6(s: string): boolean {
  const halves = s.split('::');
  if (halves.length > 2) return false;
  const groups = halves.flatMap((h) => (h === '' ? [] : h.split(':')));
  if (!groups.every((g) => /^[0-9a-f]{1,4}$/i.test(g))) return false;
  return halves.length === 2 ? groups.length <= 7 : groups.length === 8;
}

/** Loopback, unspecified, link-local (fe80::/10) or unique local (fc00::/7). */
function privateV6(s: string): boolean {
  const l = s.toLowerCase();
  return l === '::' || l === '::1' || /^fe[89ab][0-9a-f]?:/.test(l) || /^f[cd][0-9a-f]{0,2}:/.test(l);
}

// four numbers, not part of a version ("Chrome/141.0.0.0") or a longer dotted run
const V4 = /(?<![\w/.])(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?![\w.])/g;
// hex and colons with two colons at least (times and MAC addresses aren't IPv6 addresses, isV6 says)
const V6 = /(?<![\w:])[0-9a-f]*(?::[0-9a-f]*){2,}(?![\w:])/gi;

/** `s` with each public IPv4 or IPv6 address in it replaced by "hidden". */
export function hideAddresses(s: string): string {
  return s
    .replace(V4, (m: string, ...g: string[]) => {
      const parts = g.slice(0, 4).map(Number);
      return parts.every((p) => p <= 255) && !privateV4(parts) ? 'hidden' : m;
    })
    .replace(V6, (m: string) => (isV6(m) && !privateV6(m) ? 'hidden' : m));
}

/** A copy of a JSON value with every string's public addresses hidden (keys too). */
export function hideAll(v: unknown): unknown {
  if (typeof v === 'string') return hideAddresses(v);
  if (Array.isArray(v)) return v.map(hideAll);
  if (typeof v === 'object' && v !== null) return Object.fromEntries(Object.entries(v).map(([k, x]) => [hideAddresses(k), hideAll(x)]));
  return v;
}

// ---- The figures ----

interface MemberPhase {
  router: RttStats;
  internet: RttStats;
  peers: RttStats;
  ping: RttStats;
  down: Throughput | undefined;
  up: Throughput | undefined;
}

export interface Summary {
  /** each phase the run reached: its window (ms from the start, without a load's first seconds), the router's figures and each device's */
  phases: {
    index: number;
    kind: string;
    label: string | null | undefined;
    from: number;
    to: number;
    router: RouterWindow;
    members: Record<string, MemberPhase>;
  }[];
  /** idle against loaded, per device and target (latency.ts) */
  latency: { member: string | null; target: LatencyTarget; idle: RttStats; loaded: RttStats; added: number | undefined; silent: boolean }[];
}

export function summary(data: RunData): Summary {
  const t0 = data.meta.t0;
  return {
    phases: runWindows(reportRun(data), data.meta.schedule.phases).map((w) => ({
      index: w.index,
      kind: w.phase.kind,
      label: w.phase.label,
      from: w.from - t0,
      to: w.to - t0,
      router: routerWindow(data.router, w),
      members: Object.fromEntries(
        data.meta.members.map((m) => {
          const recs = data.records.get(m.id) ?? [];
          return [
            m.id,
            {
              router: rttStats(memberRtts(recs, 'r', w)),
              internet: rttStats(memberRtts(recs, 'w', w)),
              peers: rttStats(memberPeerRtts(recs, w)),
              ping: rttStats(routerRtts(data.probes, m.id, w)),
              down: memberThroughput(recs, 'd', w),
              up: memberThroughput(recs, 'u', w),
            },
          ];
        }),
      ),
    })),
    latency: latencyRows(data).map((r) => ({ member: r.member, target: r.target, idle: r.idle, loaded: r.loaded, added: r.added, silent: r.silent })),
  };
}

// ---- The file ----

export interface BenchExport {
  format: typeof EXPORT_FORMAT;
  /** when it was saved, ISO 8601 */
  exported: string;
  router: { model: string | null; firmware: string | null };
  /** the stored run: plan, members as they joined, settings (router ms, as every time in the file) */
  run: RunData['meta'];
  end: RunData['end'];
  data: {
    members: Record<string, RunRecord[]>;
    probes: RunData['probes'];
    router: RunData['router'];
    dns: RunData['dns'];
  };
  summary: Summary;
  checks: Check[];
  thresholds: Thresholds;
}

export function buildExport(data: RunData, checks: readonly Check[], thresholds: Thresholds, now: Date = new Date()): BenchExport {
  const out: BenchExport = {
    format: EXPORT_FORMAT,
    exported: now.toISOString(),
    router: { model: data.meta.settings.model ?? null, firmware: data.meta.settings.firmware ?? null },
    run: data.meta,
    end: data.end,
    data: { members: Object.fromEntries(data.records), probes: data.probes, router: data.router, dns: data.dns },
    summary: summary(data),
    checks: [...checks],
    thresholds,
  };
  return hideAll(JSON.parse(JSON.stringify(out))) as BenchExport;
}

export function exportName(data: RunData): string {
  const d = new Date(data.meta.created_wall * 1000);
  const day = `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return `milkflint-bench-${day}-${data.meta.id}.json`;
}

const fileSchema = z.object({
  format: z.literal(EXPORT_FORMAT),
  exported: z.string(),
  run: storedRunSchema,
  end: runEndSchema.nullable(),
  data: z.object({
    members: z.record(z.string(), z.array(z.array(z.unknown()))),
    probes: z.array(z.unknown()),
    router: z.array(z.unknown()),
    dns: z.object({ upstream: z.unknown(), lookups: z.array(z.unknown()) }),
  }),
  thresholds: z.unknown(),
});

/** An exported run, read back: its data as the report takes it (each part checked as the router's would be), and the thresholds it was saved with. */
export function parseExport(text: string): { data: RunData; thresholds: Thresholds; exported: string } {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    throw new Error('not a JSON file');
  }
  const f = fileSchema.safeParse(v);
  if (!f.success) throw new Error(`not a ${EXPORT_FORMAT} file`);
  const x = f.data;
  const lines = (vs: readonly unknown[]): string[] => vs.map((l) => JSON.stringify(l));
  const records = new Map<string, RunRecord[]>();
  for (const m of x.run.members) records.set(m.id, (x.data.members[m.id] ?? []).filter(isRecord));
  return {
    data: {
      meta: x.run,
      end: x.end,
      records,
      probes: parseProbes(lines(x.data.probes)),
      router: parseRouter(lines(x.data.router)),
      dns: parseDns([JSON.stringify({ upstream: x.data.dns.upstream }), ...lines(x.data.dns.lookups)]),
    },
    thresholds: parseThresholds(x.thresholds),
    exported: x.exported,
  };
}
