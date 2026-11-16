// What the Nearby networks page says about each of this router's bands from
// a scan: whether anyone shares its channels, the loudest that does, and
// whether a clearly quieter place exists at its width. Pure, so it's tested
// (tests/wifi-scan-model.test.ts).
import type { RegRule } from '@/lib/api/wireless';
import type { ScannedNetwork, ScanState } from './api';
import { bandChannels, type BandId, channelMhz, emptyNarrower, overlapMhz, quietest, spanOf } from './spectrum';

/** One of this router's radios, as it runs now. */
export interface Radio {
  radio: string;
  band: BandId;
  phy: string | undefined;
  /** Its access point is up and on a channel: it can scan. */
  online: boolean;
  /** Set to Auto (it picked its channel at start-up). */
  auto: boolean;
  channel: number | undefined;
  span: [number, number] | undefined;
  width: number;
  country: string | undefined;
}

/** The 20 MHz channels a country lets a radio start a network on. */
export function allowedChannels(band: BandId, rules: readonly RegRule[] | undefined): Set<number> | undefined {
  if (rules === undefined) return undefined;
  return new Set(
    bandChannels(band).filter((c) => {
      const mhz = channelMhz(band, c);
      return rules.some((r) => mhz - 10 >= r.start && mhz + 10 <= r.end && !r.no_ir);
    }),
  );
}

/** The 20 MHz channels that need a radar check first (DFS). */
export function dfsChannels(band: BandId, rules: readonly RegRule[] | undefined): Set<number> {
  return new Set(
    bandChannels(band).filter((c) => {
      const mhz = channelMhz(band, c);
      return rules?.some((r) => mhz - 10 >= r.start && mhz + 10 <= r.end && r.dfs) === true;
    }),
  );
}

/** The 20 MHz channels this router's network covers. */
export function ownChannelsOf(band: BandId, span: readonly [number, number]): number[] {
  return bandChannels(band).filter((c) => {
    const mhz = channelMhz(band, c);
    return mhz - 10 >= span[0] - 1 && mhz + 10 <= span[1] + 1;
  });
}

/** "6", or "36–48" for a block. */
export function blockLabel(channels: readonly number[]): string {
  const first = channels[0];
  const last = channels.at(-1);
  if (first === undefined || last === undefined) return '';
  return first === last ? String(first) : `${String(first)}–${String(last)}`;
}

/** "Quietest 160 MHz block: 100–128": for this router's width (2.4 GHz and 20 MHz: a channel). */
export function quietestLabel(band: BandId, width: number, channels: readonly number[]): string {
  return band === '2g' || width <= 20
    ? `Quietest channel: ${blockLabel(channels)}`
    : `Quietest ${String(width)} MHz block: ${blockLabel(channels)}`;
}

/** Results older than this are shown fainter, with a nudge to scan again: networks come and go. */
export const STALE_AFTER_S = 5 * 60;

/** "5 minutes", "2 hours", "3 days". */
export function howLong(seconds: number): string {
  const [n, unit] =
    seconds < 3600
      ? [Math.floor(seconds / 60), 'minute']
      : seconds < 86400
        ? [Math.floor(seconds / 3600), 'hour']
        : [Math.floor(seconds / 86400), 'day'];
  return `${String(n)} ${unit}${n === 1 ? '' : 's'}`;
}

/** Whole minutes, hours or days, as the scan's age is said. */
export function ago(seconds: number): string {
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${String(Math.floor(seconds / 60))} min ago`;
  if (seconds < 86400) return `${String(Math.floor(seconds / 3600))} h ago`;
  return `${String(Math.floor(seconds / 86400))} d ago`;
}

/**
 * The bands a finished scan listened on (a radio that failed didn't). A
 * router that doesn't list its radios: every band it heard or was asked.
 */
export function scannedBands(scan: ScanState | undefined): Set<string> {
  if (scan?.state !== 'done') return new Set();
  if (scan.radios === undefined) return new Set(['2g', '5g', '6g']);
  return new Set(scan.radios.flatMap((r) => (r.error === null && r.band !== null ? [r.band] : [])));
}

/**
 * off: the band has no network on air; unscanned: the last scan didn't
 * listen there; clear: no other network on its channels; shared: some, but
 * nowhere is clearly quieter; quieter: a clearly quieter place exists.
 */
export type BandState = 'off' | 'unscanned' | 'clear' | 'shared' | 'quieter';

export interface Block {
  channels: number[];
  /** Some of it needs a radar check first. */
  dfs: boolean;
}

export interface BandAnswer {
  state: BandState;
  /** Where this router is: "channel 6", "channels 36–48". */
  where: string | undefined;
  /** Networks that overlap this router's channels, and the loudest of them. */
  sharing: number;
  loudest: ScannedNetwork | undefined;
  /** Networks heard on the band in all. */
  heard: number;
  /** The quietest place at this router's width. */
  best: Block | undefined;
  /** Set when `best` is clearly quieter than where it is now: worth moving to. */
  move: Block | undefined;
  /** No block at this router's width is free, but narrower ones are. */
  free: { width: number; blocks: Block[] } | undefined;
}

/** How much quieter (in loud neighbours, about) a place has to be to be worth moving to. */
const WORTH_MOVING = 0.35;

/** What the last scan says about one of this router's bands. */
export function bandAnswer(
  radio: Radio,
  networks: readonly ScannedNetwork[],
  rules: readonly RegRule[] | undefined,
  scanned: boolean,
): BandAnswer {
  const span = radio.span;
  const mine = span === undefined ? [] : ownChannelsOf(radio.band, span);
  const where =
    span === undefined || radio.channel === undefined
      ? undefined
      : radio.band === '2g' || mine.length <= 1
        ? `channel ${radio.band === '2g' ? String(radio.channel) : blockLabel(mine)}`
        : `channels ${blockLabel(mine)}`;
  const empty = { where, sharing: 0, loudest: undefined, heard: 0, best: undefined, move: undefined, free: undefined };
  if (span === undefined) return { state: 'off', ...empty };
  if (!scanned) return { state: 'unscanned', ...empty };

  const here = networks.filter((n) => n.band === radio.band);
  const sharing = here.filter((n) => overlapMhz(spanOf(n), span) > 0);
  const loudest = sharing.reduce<ScannedNetwork | undefined>(
    (a, n) => (a === undefined || (n.signal ?? -200) > (a.signal ?? -200) ? n : a),
    undefined,
  );
  const allowed = allowedChannels(radio.band, rules);
  const dfs = dfsChannels(radio.band, rules);
  const block = (channels: number[]): Block => ({ channels, dfs: channels.some((c) => dfs.has(c)) });
  const best = quietest(radio.band, radio.width, here, allowed);
  const current = quietest(radio.band, radio.width, here, new Set(mine));
  const isCurrent = best !== undefined && mine.length > 0 && best.channels.every((c) => mine.includes(c));
  // worth moving only for a clearly quieter place (a loud neighbour or two)
  const better = best !== undefined && current !== undefined && !isCurrent && current.load - best.load > WORTH_MOVING;
  const free = emptyNarrower(radio.band, radio.width, here, allowed);
  return {
    state: sharing.length === 0 ? 'clear' : better ? 'quieter' : 'shared',
    where,
    sharing: sharing.length,
    loudest,
    heard: here.length,
    best: best === undefined ? undefined : block(best.channels),
    move: better ? block(best.channels) : undefined,
    free: free === undefined ? undefined : { width: free.width, blocks: free.blocks.map(block) },
  };
}
