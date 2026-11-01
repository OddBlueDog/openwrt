// How well a run's members kept to its schedule, from what they sent the
// router: when each phase started on each device against when it should
// have (both in router time, through the device's clock sync), and whether
// the device was hidden or out of reach meanwhile.
import { z } from 'zod';
import type { ReportRun } from './analysis';
import type { Phase } from './api';
import type { RunRecord } from './member';
import { phaseAt } from './plans';
import { validHost } from './pages';
import { linkDiagSchema } from './rtc-diag';

/** A line of a member's part of a stored run (m-<member>.jsonl). */
const lineSchema = z.object({ m: z.string(), seq: z.number(), records: z.array(z.array(z.unknown())) });

/** The records in a member's lines, in order, each report once. */
export function memberRecords(lines: readonly string[]): RunRecord[] {
  const bySeq = new Map<number, unknown[][]>();
  for (const l of lines) {
    let v: unknown;
    try {
      v = JSON.parse(l);
    } catch {
      continue;
    }
    const p = lineSchema.safeParse(v);
    if (p.success && !bySeq.has(p.data.seq)) bySeq.set(p.data.seq, p.data.records);
  }
  const out: RunRecord[] = [];
  for (const seq of [...bySeq.keys()].sort((a, b) => a - b)) {
    for (const r of bySeq.get(seq) ?? []) {
      if (isRecord(r)) out.push(r);
    }
  }
  return out;
}

export function isRecord(r: unknown[]): r is RunRecord {
  const num = (i: number): boolean => typeof r[i] === 'number' && Number.isFinite(r[i]);
  const partner = (i: number): boolean => typeof r[i] === 'string' && /^m\d{1,6}$/.test(r[i]);
  const site = (i: number): boolean => typeof r[i] === 'string' && validHost(r[i]);
  switch (r[0]) {
    case 'mark':
      return num(1) && num(2) && num(3) && num(4);
    case 'clock':
      return num(1) && num(2) && num(3);
    case 'hidden':
    case 'visible':
    case 'lost':
    case 'found':
      return num(1);
    case 'end':
    case 'err':
      return num(1) && typeof r[2] === 'string';
    case 'rtt':
      return (r[1] === 'r' || r[1] === 'w') && num(2) && num(3) && (r[4] === null || num(4));
    case 'tp':
      return (r[1] === 'd' || r[1] === 'u') && num(2) && num(3);
    case 'cf':
      return num(1) && num(2) && num(3) && num(4) && num(5);
    case 'budget':
      return num(1) && num(2);
    case 'peer':
      return (
        num(1) && partner(2) && (r[3] === 'p' || r[3] === 'b') && (r[4] === 'open' || r[4] === 'fail' || r[4] === 'wait') && linkDiagSchema.safeParse(r[5]).success
      );
    case 'pp':
      return partner(1) && num(2) && num(3) && (r[4] === null || num(4));
    case 'pr':
      return partner(1) && num(2) && Array.isArray(r[3]) && r[3].every((n) => typeof n === 'number' && Number.isFinite(n));
    case 'pb':
      return partner(1) && num(2) && num(3);
    case 'cold':
      return site(1) && num(2) && (r[3] === null || num(3)) && (r[4] === 'failed' || r[4] === 'answered' || r[4] === 'timeout');
    case 'page':
      return site(1) && num(2) && (r[3] === null || num(3)) && (r[4] === 'first' || r[4] === 'repeat');
    default:
      return false;
  }
}

export interface MemberTiming {
  /** phases it marked, of those it should have */
  marked: number;
  phases: number;
  /** how late (positive) or early each phase started, ms: the median and the worst, by size */
  skewMedian: number | undefined;
  skewWorst: number | undefined;
  /** the largest clock uncertainty it ran with, ms */
  uncertainty: number | undefined;
  hidden: boolean;
  lost: boolean;
  ended: string | undefined;
}

export function median(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
}

/** How many of its phases a run reached: all of them, unless it ended early. */
export function phasesReached(run: ReportRun, phases: readonly Pick<Phase, 'start' | 'dur'>[]): number {
  const endT = run.ended === undefined || run.ended === null ? undefined : run.ended.at - run.t0;
  if (endT === undefined) return phases.length;
  if (endT < 0) return 0;
  const last = phaseAt({ phases }, endT);
  return last === -1 ? phases.length : last + 1;
}

/** `phases`: how many phases the run had (or reached, if it was stopped). */
export function memberTiming(records: readonly RunRecord[], phases: number): MemberTiming {
  const skews: number[] = [];
  const marked = new Set<number>();
  let uncertainty: number | undefined;
  let hidden = false;
  let lost = false;
  let ended: string | undefined;
  for (const r of records) {
    if (r[0] === 'mark') {
      if (marked.has(r[1])) continue;
      marked.add(r[1]);
      skews.push(r[3] - r[2]);
      uncertainty = Math.max(uncertainty ?? 0, r[4]);
    } else if (r[0] === 'hidden') hidden = true;
    else if (r[0] === 'lost') lost = true;
    else if (r[0] === 'end') ended ??= r[2];
  }
  let worst: number | undefined;
  for (const s of skews) if (worst === undefined || Math.abs(s) > Math.abs(worst)) worst = s;
  return { marked: marked.size, phases, skewMedian: median(skews), skewWorst: worst, uncertainty, hidden, lost, ended };
}
