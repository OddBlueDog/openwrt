// A finished run's raw parts, read from the router page by page: what it
// was (the plan, its members as they were, the settings), each member's
// records, the router's pings, its samples and its DNS lookups.
import { useEffect, useState } from 'react';
import { errorMessage } from '@/lib/utils';
import { BenchError, getRunMeta, getRunPage, memberRunMeta, memberRunPage, type RunEnd, type RunMeta, type RunPage, type StoredRun } from './api';
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

/** Who reads a run: the admin (any stored run), or a member with its own session (its bench's runs). */
export type RunReader = { admin: true } | { session: string };

const readerKey = (r: RunReader | undefined): string | undefined => (r === undefined ? undefined : 'admin' in r ? 'admin' : r.session);

function reading(key: string): { meta: (run: string) => Promise<RunMeta>; page: (run: string, part: string, from: number) => Promise<RunPage> } {
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

/**
 * Reads a run once it's over (`ready`). A run that has just ended waits
 * `delayMs` first, while its members send what they still hold.
 */
export function useRunData(reader: RunReader | undefined, run: string, ready: boolean, delayMs = 0): { data: RunData | undefined; error: string | undefined } {
  const key = readerKey(reader);
  // kept with its run's id: a new run's page mustn't show the last one's figures
  const [loaded, setLoaded] = useState<{ run: string; data: RunData }>();
  const [failed, setFailed] = useState<{ run: string; error: string }>();
  useEffect(() => {
    if (!ready || key === undefined || run === '') return;
    let cancelled = false;
    const t = setTimeout(() => {
      load(key, run).then(
        (data) => {
          if (!cancelled) setLoaded({ run, data });
        },
        (err: unknown) => {
          if (!cancelled) setFailed({ run, error: errorMessage(err) });
        },
      );
    }, delayMs);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [ready, key, run, delayMs]);
  return { data: loaded?.run === run ? loaded.data : undefined, error: failed?.run === run ? failed.error : undefined };
}
