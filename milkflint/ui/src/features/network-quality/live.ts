// The probe's samples of the last hour, for the Network Quality page and the
// dashboard. Each poll asks only for the samples newer than the last one.
import { useRef } from 'react';
import { usePoll } from '@/hooks/use-poll';
import { getStatus, type Sample, type Status } from './api';

/** The score and bars cover the last five minutes; the chart the last hour. */
export const WINDOW_SECONDS = 300;

export interface Live {
  status: Status;
  samples: Sample[];
}

export function useLive(intervalMs: number): ReturnType<typeof usePoll<Live>> {
  const samples = useRef<Sample[]>([]);
  return usePoll(async (): Promise<Live> => {
    const last = samples.current[samples.current.length - 1]?.t ?? 0;
    const status = await getStatus(last);
    const cutoff = status.now - 3600;
    samples.current = [...samples.current, ...status.samples].filter((s) => s.t > cutoff);
    return { status, samples: samples.current };
  }, intervalMs);
}
