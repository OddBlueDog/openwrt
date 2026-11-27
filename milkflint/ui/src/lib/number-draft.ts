import { formatNumber } from '@/lib/format';

export interface Bounds {
  min?: number | undefined;
  max?: number | undefined;
  integer?: boolean | undefined;
}

/** What a number box's text means: usable as it is, usable once pulled into range, or nothing yet. */
export type Draft = { kind: 'ok'; value: number } | { kind: 'out'; value: number } | { kind: 'empty' };

/** Reads the text of a number box. `out` carries the value already clamped into the bounds. */
export function readDraft(text: string, bounds: Bounds): Draft {
  if (text.trim() === '') return { kind: 'empty' };
  const n = Number(text);
  if (!Number.isFinite(n)) return { kind: 'empty' };
  const v = bounds.integer === true ? Math.round(n) : n;
  const clamped = Math.min(bounds.max ?? Infinity, Math.max(bounds.min ?? -Infinity, v));
  return clamped === v ? { kind: 'ok', value: v } : { kind: 'out', value: clamped };
}

/** The range in words, for a hint under the box. */
export function boundsText({ min, max }: Bounds): string {
  if (min !== undefined && max !== undefined) return `${formatNumber(min)} to ${formatNumber(max)}`;
  if (min !== undefined) return `at least ${formatNumber(min)}`;
  if (max !== undefined) return `at most ${formatNumber(max)}`;
  return '';
}
