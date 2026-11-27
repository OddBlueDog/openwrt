// The process list's sums, kept apart from React so they can be tested: two
// readings make each process's share of the processor (as top works it
// out), plus the names, filtering and order the list uses.
import type { Process, ProcessList } from '@/lib/api/processes';

/** Clock ticks a second in /proc (USER_HZ): fixed at 100 on Linux. */
export const CLOCK_TICKS = 100;
/** The kernel keeps a process's name (comm) to this many characters. */
const COMM_MAX = 15;

export interface ProcessRow {
  /** pid and start: a pid used again by a new process is a new row */
  key: string;
  p: Process;
  name: string;
  /** share of the whole processor since the reading before; undefined until there are two */
  cpu: number | undefined;
  /** share of the router's memory */
  memory: number;
}

export interface Snapshot {
  rows: ProcessRow[];
  /** the processor in use since the reading before; undefined on the first */
  cpu: number | undefined;
  /** memory in use (all but what's available) */
  memory: number;
  cores: number;
  uptime: number;
  /** each process's name by pid, for "started by" */
  names: ReadonlyMap<number, string>;
}

const keyOf = (p: Process): string => `${String(p.pid)}:${String(p.start)}`;

/**
 * A program's own name. The kernel cuts names at 15 characters, so a longer
 * one comes from its command line: the program, or the script a shell runs
 * ("banip-service.s" is /bin/sh running banip-service.sh).
 */
export function displayName(p: Process): string {
  if (p.kernel || p.name.length < COMM_MAX) return p.name;
  for (const arg of p.cmd.split(' ').slice(0, 3)) {
    const base = arg.slice(arg.lastIndexOf('/') + 1);
    if (base.startsWith(p.name)) return base;
  }
  return p.name;
}

const clamp = (n: number): number => Math.max(0, Math.min(1, n));

/** The list as it stands, with each process's share of the processor between `prev` and `next`. */
export function snapshot(prev: ProcessList | undefined, next: ProcessList): Snapshot {
  const before = new Map(prev?.processes.map((p) => [keyOf(p), p]));
  const elapsed = prev === undefined ? 0 : next.cpu.total - prev.cpu.total;
  const prevUptimeTicks = (prev?.uptime ?? 0) * CLOCK_TICKS;
  const total = next.memory.total;

  const rows = next.processes.map((p): ProcessRow => {
    const key = keyOf(p);
    let cpu: number | undefined;
    if (elapsed > 0) {
      const was = before.get(key);
      // one that started since the reading before: all its time is new
      if (was !== undefined) cpu = clamp((p.ticks - was.ticks) / elapsed);
      else if (p.start >= prevUptimeTicks) cpu = clamp(p.ticks / elapsed);
    }
    return { key, p, name: displayName(p), cpu, memory: total > 0 ? clamp(p.rss / total) : 0 };
  });

  return {
    rows,
    cpu: prev === undefined || elapsed <= 0 ? undefined : clamp(1 - (next.cpu.idle - prev.cpu.idle) / elapsed),
    memory: total > 0 ? clamp((total - next.memory.available) / total) : 0,
    cores: next.cores,
    uptime: next.uptime,
    names: new Map(next.processes.map((p) => [p.pid, displayName(p)])),
  };
}

export type ProcessView = 'all' | 'programs' | 'kernel';

/** The first comparison that tells two rows apart. */
const first = (...order: number[]): number => order.find((n) => n !== 0) ?? 0;
const words = (a: string, b: string): number => a.localeCompare(b, 'en-GB', { sensitivity: 'base' });

/**
 * The rows in view: by kind and by a few typed letters of a name, command,
 * user or pid; the biggest in memory first, then by name and pid. The
 * table's sort keeps that order among rows it can't tell apart: idle
 * processes under CPU go by memory, and kernel threads (which hold none)
 * under Memory by name.
 */
export function shownRows(rows: readonly ProcessRow[], view: ProcessView, query: string): ProcessRow[] {
  const q = query.trim().toLowerCase();
  return rows
    .filter(
      (r) =>
        (view === 'all' || (view === 'kernel') === r.p.kernel) &&
        (q === '' ||
          r.name.toLowerCase().includes(q) ||
          r.p.cmd.toLowerCase().includes(q) ||
          r.p.user.toLowerCase().includes(q) ||
          String(r.p.pid) === q),
    )
    .sort((a, b) => first(b.p.rss - a.p.rss, words(a.name, b.name), a.p.pid - b.p.pid));
}

/** A share of the processor or memory: tenths below 10 %, so small ones still show. */
export function formatShare(fraction: number): string {
  const pct = fraction * 100;
  if (pct === 0) return '0%';
  if (pct < 0.1) return '<0.1%';
  return `${pct < 10 ? pct.toFixed(1) : pct.toFixed(0)}%`;
}

const states: Readonly<Record<string, string>> = {
  R: 'Running',
  S: 'Sleeping',
  D: 'Waiting on a device',
  I: 'Idle',
  Z: 'Zombie: ended, not yet collected',
  T: 'Stopped',
  t: 'Stopped by a debugger',
  X: 'Ending',
};

/** proc(5)'s state letter in words, with the letter as top shows it. */
export function stateLabel(state: string): string {
  const words = states[state];
  return words === undefined ? state : `${words} (${state})`;
}
