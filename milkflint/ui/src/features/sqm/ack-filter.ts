// CAKE's ACK filter on the upload (keywords in sqm's eqdisc_opts). A download
// sends a stream of small acknowledgements back up the line, and each new one
// makes the ones queued before it redundant: on a line whose upload is far
// slower than its download, they take a real share of the upload.

/** CAKE's keywords for it, managed together */
export const ACK_FILTER = ['ack-filter', 'ack-filter-aggressive', 'no-ack-filter'];

/** 'custom': the aggressive filter, set in LuCI and kept */
export type AckFilter = 'off' | 'on' | 'custom';

/** Download speed as a multiple of upload above which the page suggests it. */
export const ACK_FILTER_RATIO = 15;

export function ackFilterOf(words: readonly string[]): AckFilter {
  if (words.includes('ack-filter-aggressive')) return 'custom';
  return words.includes('ack-filter') ? 'on' : 'off';
}

/** Whether these speeds (as typed, in any one unit) are lopsided enough to suggest the filter. */
export function suggestsAckFilter(download: string, upload: string): boolean {
  const d = Number(download);
  const u = Number(upload);
  return Number.isFinite(d) && Number.isFinite(u) && d > 0 && u > 0 && d / u > ACK_FILTER_RATIO;
}
