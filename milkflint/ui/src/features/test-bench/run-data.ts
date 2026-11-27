// A finished run's raw parts, read from the router page by page: what it
// was (the plan, its members as they were, the settings), each member's
// records, the router's pings, its samples and its DNS lookups.
import {
  BenchError,
  getRunMeta,
  getRunPage,
  memberRunMeta,
  memberRunPage,
  type RunEnd,
  type RunMeta,
  type RunPage,
  type StoredRun,
} from './api';
import { parseProbes, parseRouter, type ProbeLine, type ReportRun, type RouterLine } from './analysis';
import { parseDns, type RouterDns } from './dns-pages';
import type { RunRecord } from './member';
import { memberRecords } from './timing';

export interface RunData {
  meta: StoredRun;
  end: RunEnd | null;
  records: Map<string, RunRecord[]>;
  probes: ProbeLine[];
  router: RouterLine[];
  dns: RouterDns;
}

export const reportRun = (d: RunData): ReportRun => ({ t0: d.meta.t0, end: d.meta.end, ended: d.end });

/**
 * Who reads a run: the admin (any stored run), or a member with its own
 * session (its bench's runs). A member's reads are kept by its id, never by
 * its session.
 */
export type RunReader = { admin: true } | { session: string; member: string };

const readerKey = (r: RunReader | undefined): string | undefined =>
  r === undefined ? undefined : 'admin' in r ? 'admin' : r.session;

function reading(key: string): {
  meta: (run: string) => Promise<RunMeta>;
  page: (run: string, part: string, from: number) => Promise<RunPage>;
} {
  return key === 'admin'
    ? { meta: getRunMeta, page: getRunPage }
    : { meta: (run) => memberRunMeta(key, run), page: (run, part, from) => memberRunPage(key, run, part, from) };
}

/** A stored run, every part of it. */
export async function loadRun(reader: RunReader, run: string): Promise<RunData> {
  return load(readerKey(reader) ?? 'admin', run);
}

async function load(key: string, run: string): Promise<RunData> {
  const r = reading(key);
  const all = async (part: string): Promise<string[]> => {
    const lines: string[] = [];
    let from: number | null = 0;
    while (from !== null) {
      const page = await r.page(run, part, from);
      lines.push(...page.lines);
      from = page.next;
    }
    return lines;
  };
  const m = await r.meta(run);
  if (m.meta === null) throw new BenchError('the run’s details are gone');
  const records = new Map<string, RunRecord[]>();
  for (const member of m.meta.members) records.set(member.id, memberRecords(await all(`m-${member.id}`)));
  return {
    meta: m.meta,
    end: m.end,
    records,
    probes: parseProbes(await all('probes')),
    router: parseRouter(await all('router')),
    dns: parseDns(await all('dns')),
  };
}
