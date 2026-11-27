// The Connections tab's graph data: TCP, UDP and other connections at each of
// the tab's own reads, kept in this browser only. Nothing is recorded while
// the tab is closed (the router keeps no history of them): what was recorded
// stays here for the rest of the visit, with a gap for the time away, and is
// gone at a reload.
import type { TimePoint } from '@/components/charts/time-axis';

export interface Sample {
  /** When the router answered, epoch ms. */
  t: number;
  tcp: number;
  udp: number;
  other: number;
}

/** What the graph shows: the last ten minutes at most. */
export const WINDOW_MS = 10 * 60_000;
/** The shortest stretch it shows, so the first reads aren't squeezed to a corner. */
export const MIN_WINDOW_MS = 60_000;
/** What's kept: half an hour, so coming back after a few minutes away still shows what came before. */
export const KEEP_MS = 30 * 60_000;
/** A gap at least this long breaks the lines (a read that didn't come, the tab away or hidden). */
export const MIN_GAP_MS = 30_000;

/** The samples with this one added: older ones than `keepMs` before it dropped, one no later than the last ignored. */
export function addSample(list: readonly Sample[], s: Sample, keepMs = KEEP_MS): readonly Sample[] {
  const last = list.at(-1);
  if (last !== undefined && s.t <= last.t) return list;
  const from = s.t - keepMs;
  const kept = list[0] !== undefined && list[0].t < from ? list.filter((x) => x.t >= from) : list;
  return [...kept, s];
}

/** The graph's time axis: from the oldest sample within the window, at least MIN_WINDOW_MS and at most WINDOW_MS before the newest. */
export function windowOf(list: readonly Sample[]): { from: number; to: number } {
  const to = list.at(-1)?.t ?? 0;
  const first = list.find((s) => s.t >= to - WINDOW_MS)?.t ?? to;
  return { from: to - Math.min(WINDOW_MS, Math.max(MIN_WINDOW_MS, to - first)), to };
}

/** How long a gap breaks the lines: three of the usual reads' spacing, and never under MIN_GAP_MS. */
export function gapOf(list: readonly Sample[]): number {
  const steps: number[] = [];
  for (let i = 1; i < list.length; i++) steps.push((list[i]?.t ?? 0) - (list[i - 1]?.t ?? 0));
  if (steps.length === 0) return MIN_GAP_MS;
  steps.sort((a, b) => a - b);
  return Math.max(MIN_GAP_MS, 3 * (steps[Math.floor(steps.length / 2)] ?? 0));
}

export interface HistorySeries {
  tcp: TimePoint[];
  udp: TimePoint[];
  other: TimePoint[];
}

/** One line per protocol from `from` on, broken (a null point) across each gap longer than `gap`. */
export function seriesOf(list: readonly Sample[], from: number, gap = gapOf(list)): HistorySeries {
  const out: HistorySeries = { tcp: [], udp: [], other: [] };
  // the last point drawn: a break only follows one
  let prev: Sample | undefined;
  for (const s of list) {
    if (s.t < from) continue;
    if (prev !== undefined && s.t - prev.t > gap) {
      const mid = (prev.t + s.t) / 2;
      out.tcp.push([mid, null]);
      out.udp.push([mid, null]);
      out.other.push([mid, null]);
    }
    out.tcp.push([s.t, s.tcp]);
    out.udp.push([s.t, s.udp]);
    out.other.push([s.t, s.other]);
    prev = s;
  }
  return out;
}

// The visit's samples, shared by every mount of the tab.
let samples: readonly Sample[] = [];
const listeners = new Set<() => void>();

export function recordSample(s: Sample): void {
  const next = addSample(samples, s);
  if (next === samples) return;
  samples = next;
  for (const l of listeners) l();
}

export function subscribeSamples(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function samplesNow(): readonly Sample[] {
  return samples;
}
