// The radar scan's plan, worked out in the browser: the 5 GHz radar channels
// as blocks to listen on, what each block's channels are doing now, and
// whether a scan of the chosen ones and length may start. Pure, so it's
// tested (tests/radar-scan-model.test.ts).
import type { Radar } from '@/lib/api/wireless';
import { describeChannels } from '../wifi/channels';
import type { BlockRequest } from './api';

export const MIN_S = 10;
export const MAX_S = 3600;
export const MAX_TOTAL_S = 7200;
/** How long a channel stays off limits after radar (the kernel's non-occupancy period). */
const NOP_S = 1800;

export const durations = [
  { value: '60', label: '1 minute (one radar check)' },
  { value: '120', label: '2 minutes' },
  { value: '300', label: '5 minutes' },
  { value: '600', label: '10 minutes (a weather radar check)' },
  { value: '1800', label: '30 minutes' },
  { value: 'custom', label: 'Custom…' },
] as const;

/** Where 80 MHz blocks start on 5 GHz. */
const BLOCK_STARTS = [36, 52, 100, 116, 132, 149, 165];

const mhzOf = (channel: number): number => 5000 + 5 * channel;

export interface BlockOption extends BlockRequest {
  key: string;
  channels: number[];
}

/** The radio's radar channels as blocks: 80 MHz where all four are radar channels, else 40, else 20. */
export function blocksOf(radar: Radar | undefined): BlockOption[] {
  const dfs = new Set((radar?.channels ?? []).map((c) => c.channel));
  const out: BlockOption[] = [];
  const add = (channels: number[]): void => {
    const first = channels[0] ?? 0;
    const last = channels.at(-1) ?? first;
    out.push({
      key: channels.join('-'),
      channels,
      freq: mhzOf(first),
      width: 20 * channels.length,
      center: (mhzOf(first) + mhzOf(last)) / 2,
    });
  };
  for (const s of BLOCK_STARTS) {
    const all = [s, s + 4, s + 8, s + 12];
    if (all.every((c) => dfs.has(c))) {
      add(all);
      continue;
    }
    for (const pair of [all.slice(0, 2), all.slice(2)]) {
      if (pair.every((c) => dfs.has(c))) add(pair);
      else for (const c of pair) if (dfs.has(c)) add([c]);
    }
  }
  return out;
}

/** "90 seconds", "a minute", "5 minutes". */
export function minutes(s: number): string {
  if (s < 90) return `${String(s)} seconds`;
  const m = Math.round(s / 60);
  return m === 1 ? 'a minute' : `${String(m)} minutes`;
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "Channels 52–64 (80 MHz)". */
export function blockLabel(b: { channels: readonly number[]; width: number }): string {
  return `${capitalize(describeChannels(b.channels))} (${String(b.width)} MHz)`;
}

/**
 * What a block's channels are doing now: off limits after radar (with the
 * minutes left), checked with no radar heard, or not checked yet.
 */
export type ChannelState = { kind: 'off-limits'; minutesLeft: number } | { kind: 'checked' } | { kind: 'unchecked' };

export function channelState(radar: Radar | undefined, channels: readonly number[]): ChannelState {
  const states = (radar?.channels ?? []).filter((c) => channels.includes(c.channel));
  const off = states.filter((c) => c.state === 'unavailable');
  if (off.length > 0) {
    const left = Math.max(...off.map((c) => NOP_S - (c.for_s ?? 0)));
    return { kind: 'off-limits', minutesLeft: Math.max(1, Math.ceil(left / 60)) };
  }
  if (states.length > 0 && states.every((c) => c.state === 'available')) return { kind: 'checked' };
  return { kind: 'unchecked' };
}

/** "2 checked with no radar heard, 1 off limits after radar and 3 not checked yet." */
export function radarSummary(radar: Radar | undefined, options: readonly BlockOption[]): string {
  const states = options.map((o) => channelState(radar, o.channels).kind);
  const count = (kind: ChannelState['kind']): number => states.filter((k) => k === kind).length;
  const parts = [
    count('checked') > 0 ? `${String(count('checked'))} checked with no radar heard` : undefined,
    count('off-limits') > 0 ? `${String(count('off-limits'))} off limits after radar` : undefined,
    count('unchecked') > 0 ? `${String(count('unchecked'))} not checked yet` : undefined,
  ].filter((p) => p !== undefined);
  if (parts.length === 0) return 'This radio has no radar channels in this country.';
  const blocks = `${String(options.length)} block${options.length === 1 ? '' : 's'}`;
  return `${blocks}: ${new Intl.ListFormat('en-GB').format(parts)}.`;
}

/** Whether a scan of `blocks`, `seconds` each, may start, and if not why; if so, what it costs. */
export function scanPlan(blocks: number, seconds: number): { ok: boolean; text: string; total: number } {
  const valid = Number.isFinite(seconds) && seconds >= MIN_S && seconds <= MAX_S;
  const total = blocks * (valid ? seconds : 0);
  if (blocks === 0) return { ok: false, text: 'Pick at least one block.', total };
  if (!valid) return { ok: false, text: `Choose between ${String(MIN_S)} and ${String(MAX_S)} seconds.`, total };
  if (total > MAX_TOTAL_S) return { ok: false, text: 'At most two hours in all: pick fewer blocks or a shorter time.', total };
  return { ok: true, text: `The 5 GHz network will be off for about ${minutes(total)}.`, total };
}
