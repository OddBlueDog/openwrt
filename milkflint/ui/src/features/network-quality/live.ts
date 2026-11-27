// The probe's samples of the last hour, for the Network Quality page and the
// dashboard: one live query both share (qualityQueries.live). A round with an
// impossible time (plausible.ts) is left out, so nothing that reads these
// shows it.
import { type Live as LiveResult, useLive as useLiveQuery } from '@/lib/query/use-live';
import type { Sample, Status } from './api';
import { qualityQueries } from './queries';

/** The score and bars cover the last five minutes; the chart the last hour. */
export const WINDOW_SECONDS = 300;

export interface Live {
  status: Status;
  samples: Sample[];
}

export function useLive(intervalMs: number): LiveResult<Live> {
  return useLiveQuery(qualityQueries.live(intervalMs));
}
