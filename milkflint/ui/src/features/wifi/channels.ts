// The 20 MHz channels a Wi-Fi channel covers at a given width, as OpenWrt
// sets it up (wifi-scripts' hostapd.uc): at 40 MHz, 2.4 GHz channels 1–6
// pair with the channel 4 above and 7–13 with the one 4 below. 5 and 6 GHz
// channels bond in fixed blocks of 2, 4, 8 or 16, counted from the first
// channel of each run (80 MHz: 36–48, 52–64, …, 149–161), so every channel
// in a block gives the same block: only the primary channel differs.

const runs: Record<string, number[]> = { '5g': [36, 100, 149], '6g': [1] };

/** The 20 MHz channels `channel` covers at `width` MHz. */
export function blockOf(band: string, channel: number, width: number): number[] {
  if (width <= 20) return [channel];
  if (band === '2g') return channel < 7 ? [channel, channel + 4] : [channel - 4, channel];
  const n = width / 20;
  const start = runs[band]?.filter((s) => s <= channel).at(-1) ?? channel;
  const first = start + Math.floor((channel - start) / (4 * n)) * 4 * n;
  return Array.from({ length: n }, (_, i) => first + 4 * i);
}

/** The block around a centre channel, as the radio reports it while it runs (center_chan1). */
export function blockAround(center: number, width: number): number[] {
  const n = Math.max(1, width / 20);
  return Array.from({ length: n }, (_, i) => center - 2 * (n - 1) + 4 * i);
}

function channelMhz(band: string, channel: number): number {
  if (band === '2g') return channel === 14 ? 2484 : 2407 + 5 * channel;
  if (band === '6g') return 5950 + 5 * channel;
  return 5000 + 5 * channel;
}

/** "149–161 (5735–5815 MHz)", or "153 (5755–5775 MHz)" for one channel. */
export function describeBlock(band: string, block: readonly number[]): string {
  const first = block[0];
  const last = block.at(-1);
  if (first === undefined || last === undefined) return '';
  const channels = first === last ? String(first) : `${String(first)}–${String(last)}`;
  return `${channels} (${String(channelMhz(band, first) - 10)}–${String(channelMhz(band, last) + 10)} MHz)`;
}

/** 80 from "HE80"; 20 for legacy (NOHT) and anything without a width. */
export function widthOf(htmode: string | undefined): number {
  const m = /(\d+)$/.exec(htmode ?? '');
  return m === null ? 20 : Number(m[1]);
}

/** Channel numbers as runs: "channel 44", "channels 36–64", "channels 52–64 and 100–112". */
export function describeChannels(list: readonly number[]): string {
  const sorted = [...new Set(list)].sort((a, b) => a - b);
  const runs: number[][] = [];
  for (const c of sorted) {
    const run = runs.at(-1);
    if (run !== undefined && c - (run.at(-1) ?? c) === 4) run.push(c);
    else runs.push([c]);
  }
  const text = runs.map((r) => (r.length === 1 ? String(r[0]) : `${String(r[0])}–${String(r.at(-1))}`));
  const joined = text.length > 1 ? `${text.slice(0, -1).join(', ')} and ${String(text.at(-1))}` : (text[0] ?? '');
  return `${sorted.length === 1 ? 'channel' : 'channels'} ${joined}`;
}
