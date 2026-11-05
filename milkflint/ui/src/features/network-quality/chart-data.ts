// The Network Quality charts' data: lines of timed points from the probe's
// samples or history, and what the chart, its table and the CSV read from
// them. Pure functions, so they are easy to check (ui/tests).
import type { Bucket, History, Sample, Stat } from './api';

export interface LinePoint {
  /** Epoch seconds. */
  t: number;
  /** Typical time (ms); undefined when nothing answered. */
  v: number | undefined;
  /** The slowest answer behind `v`, when it stands for several probes. */
  worst?: number | undefined;
  lost: number;
  rounds: number;
}

export interface ChartLine {
  key: string;
  label: string;
  /** Where it measures to, e.g. a host name. */
  detail?: string | undefined;
  color: string;
  points: LinePoint[];
  /** False for a gateway that doesn't answer pings: its silence isn't loss. */
  countLoss: boolean;
}

/** How a line reads the probe's samples and history. */
export interface LineSpec {
  key: string;
  label: string;
  detail?: string | undefined;
  color: string;
  countLoss?: boolean;
  /** A sample's time; null when lost, undefined when not asked. */
  sample: (s: Sample) => number | null | undefined;
  bucket: (b: Bucket) => Stat | undefined;
}

export function liveLine(spec: LineSpec, samples: readonly Sample[]): ChartLine {
  const points: LinePoint[] = [];
  for (const s of samples) {
    const v = spec.sample(s);
    if (v !== undefined) points.push({ t: s.t, v: v ?? undefined, lost: v === null ? 1 : 0, rounds: 1 });
  }
  return { key: spec.key, label: spec.label, detail: spec.detail, color: spec.color, countLoss: spec.countLoss ?? true, points };
}

export function historyLine(spec: LineSpec, history: History): ChartLine {
  const points: LinePoint[] = [];
  for (const b of history.buckets) {
    const stat = spec.bucket(b);
    if (stat === undefined || stat === null || stat[3] === 0) continue;
    points.push({
      t: history.start + b.i * history.step,
      v: stat[0] ?? undefined,
      worst: stat[1] ?? undefined,
      lost: stat[2],
      rounds: stat[3],
    });
  }
  return { key: spec.key, label: spec.label, detail: spec.detail, color: spec.color, countLoss: spec.countLoss ?? true, points };
}

/** The time between a line's points, whatever the probe's setting was: their median. */
export function pointStep(points: readonly LinePoint[], fallback = 60): number {
  const gaps: number[] = [];
  for (let i = 1; i < points.length; i++) gaps.push((points[i]?.t ?? 0) - (points[i - 1]?.t ?? 0));
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor((gaps.length - 1) / 2)] ?? fallback;
}

/** Points further apart than this many steps have nothing recorded between them. */
const GAP_STEPS = 2.5;

/** The line's points as runs: split where it got no answer and where nothing was recorded. */
export function runs(points: readonly LinePoint[], step = pointStep(points)): (LinePoint & { v: number })[][] {
  const out: (LinePoint & { v: number })[][] = [];
  let run: (LinePoint & { v: number })[] = [];
  let lastT: number | undefined;
  for (const p of points) {
    const broken = p.v === undefined || (lastT !== undefined && p.t - lastT > step * GAP_STEPS);
    if (broken && run.length > 0) {
      out.push(run);
      run = [];
    }
    if (p.v !== undefined) run.push({ ...p, v: p.v });
    lastT = p.t;
  }
  if (run.length > 0) out.push(run);
  return out;
}

export interface LineStats {
  /** The latest result; null when it got no answer, undefined with no points. */
  now: number | null | undefined;
  typical: number | undefined;
  best: number | undefined;
  /** 95th percentile, like the page's 5-minute Worst. */
  worst: number | undefined;
  /** Share of probes without answer. */
  loss: number;
  rounds: number;
}

export function lineStats(line: ChartLine): LineStats {
  const typical = line.points.flatMap((p) => (p.v === undefined ? [] : [p.v])).sort((a, b) => a - b);
  const slow = line.points.flatMap((p) => { const w = p.worst ?? p.v; return w === undefined ? [] : [w]; }).sort((a, b) => a - b);
  const rounds = line.points.reduce((n, p) => n + p.rounds, 0);
  const lost = line.points.reduce((n, p) => n + p.lost, 0);
  const last = line.points[line.points.length - 1];
  return {
    now: last === undefined ? undefined : (last.v ?? null),
    typical: typical[Math.floor((typical.length - 1) / 2)],
    best: typical[0],
    worst: slow[Math.min(slow.length - 1, Math.floor(slow.length * 0.95))],
    loss: rounds === 0 ? 0 : lost / rounds,
    rounds,
  };
}

/** A share lost: a rare loss over a long span still shows, "0.3%". */
export function formatLoss(share: number): string {
  const pct = share * 100;
  if (pct === 0) return '0%';
  if (pct < 0.1) return '<0.1%';
  return `${String(Math.round(pct * (pct < 10 ? 10 : 1)) / (pct < 10 ? 10 : 1))}%`;
}

/** A y scale: a round top at or above `peak` (never below `atLeast`) and even ticks up to it. */
export function niceScale(peak: number, atLeast = 0): { max: number; ticks: number[] } {
  const value = Math.max(peak * 1.1, atLeast, 1);
  const rough = value / 4;
  const exp = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * exp).find((s) => s >= rough) ?? 10 * exp;
  const count = Math.ceil(value / step);
  return { max: count * step, ticks: Array.from({ length: count + 1 }, (_, i) => i * step) };
}

/** Clock times on round marks between `start` and `end`, in the browser's time zone. */
export function timeTicks(start: number, end: number): { t: number; label: string }[] {
  const span = end - start;
  const days = span > 36 * 3600;
  const every = days ? 86400 : span > 3 * 3600 ? 4 * 3600 : 900;
  const offset = (t: number): number => new Date(t * 1000).getTimezoneOffset() * 60;
  const out: { t: number; label: string }[] = [];
  let t = start - ((start - offset(start)) % every) + every;
  for (; t < end - span * 0.05; t += every) {
    // a clock change moves the marks by an hour for the rest of the span: put them back
    const at = t - ((t - offset(t)) % every);
    const date = new Date(at * 1000);
    out.push({
      t: at,
      label: days
        ? date.toLocaleDateString(undefined, { weekday: 'short' })
        : date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
    });
  }
  return out;
}

export interface TimeRange {
  from: number;
  to: number;
}

/** Stretches with nothing recorded by any line: before the first point, between points, after the last. */
export function unrecorded(lines: readonly ChartLine[], start: number, end: number): TimeRange[] {
  const times = [...new Set(lines.flatMap((l) => l.points.map((p) => p.t)))].sort((a, b) => a - b);
  const step = Math.min(...lines.filter((l) => l.points.length > 1).map((l) => pointStep(l.points)), 900);
  const limit = step * GAP_STEPS;
  const out: TimeRange[] = [];
  let last = start;
  for (const t of [...times, end]) {
    if (t - last > limit) out.push({ from: last, to: t });
    last = t;
  }
  return out;
}

/** The loss strip's slices of the span. */
const LOSS_BINS = 240;

/** The share of probes lost, in `bins` slices of the span; only the slices with loss. */
export function lossBins(lines: readonly ChartLine[], start: number, end: number, bins = LOSS_BINS): { from: number; to: number; share: number }[] {
  const lost = new Array<number>(bins).fill(0);
  const rounds = new Array<number>(bins).fill(0);
  const width = (end - start) / bins;
  for (const l of lines) {
    if (!l.countLoss) continue;
    for (const p of l.points) {
      if (p.t < start || p.t > end) continue;
      const i = Math.min(bins - 1, Math.floor((p.t - start) / width));
      lost[i] = (lost[i] ?? 0) + p.lost;
      rounds[i] = (rounds[i] ?? 0) + p.rounds;
    }
  }
  const out: { from: number; to: number; share: number }[] = [];
  for (let i = 0; i < bins; i++) {
    const n = lost[i] ?? 0;
    if (n > 0) out.push({ from: start + i * width, to: start + (i + 1) * width, share: n / (rounds[i] ?? 1) });
  }
  return out;
}

export interface LossSlice {
  from: number;
  to: number;
  /** The lines that lost probes in the slice. */
  lines: { label: string; color: string; lost: number; rounds: number }[];
  lost: number;
  rounds: number;
}

/** The slice of the loss strip at `fraction` (0..1) of the span, and what was lost in it. */
export function lossSliceAt(lines: readonly ChartLine[], start: number, end: number, fraction: number, bins = LOSS_BINS): LossSlice {
  const width = (end - start) / bins;
  const i = Math.min(bins - 1, Math.max(0, Math.floor(fraction * bins)));
  const from = start + i * width;
  const to = from + width;
  const slice: LossSlice = { from, to, lines: [], lost: 0, rounds: 0 };
  for (const l of lines) {
    if (!l.countLoss) continue;
    const inSlice = l.points.filter((p) => Math.min(bins - 1, Math.floor((p.t - start) / width)) === i && p.t >= start && p.t <= end);
    const lost = inSlice.reduce((n, p) => n + p.lost, 0);
    const rounds = inSlice.reduce((n, p) => n + p.rounds, 0);
    slice.lost += lost;
    slice.rounds += rounds;
    if (lost > 0) slice.lines.push({ label: l.label, color: l.color, lost, rounds });
  }
  return slice;
}

/** A slice's times: "14:06–14:12", with seconds when it's under a minute, the weekday over a few days. */
export function formatSliceTime(from: number, to: number, spanSeconds: number): string {
  const opts: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
  if (to - from < 60) opts.second = '2-digit';
  const time = (t: number): string => new Date(t * 1000).toLocaleTimeString(undefined, opts);
  const day = spanSeconds > 36 * 3600 ? `${new Date(from * 1000).toLocaleDateString(undefined, { weekday: 'short' })} ` : '';
  return `${day}${time(from)}–${time(to)}`;
}

/**
 * A line for each hover slot (`start + i * step`), from its nearest point if
 * near enough: the value, the worst behind it (only where it stands for
 * several probes and differs), and a note saying so or that it was lost.
 */
export function slotValues(
  line: ChartLine,
  start: number,
  step: number,
  slots: number,
  format: (v: number) => string,
): { values: (number | undefined)[]; upper: (number | undefined)[]; notes: (string | undefined)[] } {
  const values: (number | undefined)[] = [];
  const upper: (number | undefined)[] = [];
  const notes: (string | undefined)[] = [];
  const reach = pointStep(line.points, step) * 0.75 + step / 2;
  let i = 0;
  for (let slot = 0; slot < slots; slot++) {
    const t = start + slot * step;
    while (i + 1 < line.points.length && Math.abs((line.points[i + 1]?.t ?? 0) - t) <= Math.abs((line.points[i]?.t ?? 0) - t)) i++;
    const p = line.points[i];
    const near = p !== undefined && Math.abs(p.t - t) <= reach ? p : undefined;
    const worst = near?.v !== undefined && near.worst !== undefined && near.rounds > 1 && near.worst > near.v ? near.worst : undefined;
    values.push(near?.v);
    upper.push(worst);
    notes.push(worst !== undefined ? `worst ${format(worst)}` : near !== undefined && near.v === undefined && line.countLoss ? 'lost' : undefined);
  }
  return { values, upper, notes };
}

// ---- CSV -------------------------------------------------------------------

function csvCell(text: string): string {
  // spreadsheets run a cell starting like a formula: a DNS server's name is typed by hand
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

const num = (v: number | undefined): string => (v === undefined ? '' : String(Math.round(v * 1000) / 1000));
const pad = (n: number): string => String(n).padStart(2, '0');

/** "2026-11-05 08:49:06": the form spreadsheets read as a time. */
function localTime(t: number): string {
  const d = new Date(t * 1000);
  return `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * A row per time any line has a point, with a line's columns empty where it
 * wasn't asked; `ms` is empty and `lost` 1 where it got no answer.
 */
export function linesToCsv(lines: readonly ChartLine[]): string {
  const withWorst = lines.map((l) => l.points.some((p) => p.worst !== undefined));
  const name = (l: ChartLine): string => l.label.replace(' · ', ' ');
  const header = ['local time', 'unix time'];
  lines.forEach((l, i) => {
    header.push(`${name(l)} ms`);
    if (withWorst[i] === true) header.push(`${name(l)} worst ms`);
    header.push(`${name(l)} lost`, `${name(l)} probes`);
  });
  const byLine = lines.map((l) => new Map(l.points.map((p) => [p.t, p])));
  const times = [...new Set(lines.flatMap((l) => l.points.map((p) => p.t)))].sort((a, b) => a - b);
  const rows = times.map((t) => {
    const row = [localTime(t), String(t)];
    byLine.forEach((points, i) => {
      const p = points.get(t);
      row.push(num(p?.v));
      if (withWorst[i] === true) row.push(num(p?.worst));
      row.push(p === undefined ? '' : String(p.lost), p === undefined ? '' : String(p.rounds));
    });
    return row.join(',');
  });
  return `${[header.map(csvCell).join(','), ...rows].join('\r\n')}\r\n`;
}

/** "milkflint-routes-24h-2026-11-05-0849.csv" */
export function csvName(what: string, span: string, now: number): string {
  const d = new Date(now * 1000);
  return `milkflint-${what}-${span}-${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.csv`;
}
