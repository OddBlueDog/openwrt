// What the test bench reads and writes through ubus (see ARCHITECTURE.md).
// A member's reads, made with its own session, are kept under its id, never
// its session. The members' own stores (member.ts, rtc.ts) poll and signal
// as they always did.
import { useMutation, type UseMutationResult, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { type LiveQuery, liveQuery, type RouterQuery, settingsQuery } from '@/lib/query/options';
import { errorMessage } from '@/lib/utils';
import { type AdminView, getRuns, getStatus, memberRuns, type RunSummary } from './api';
import { loadRun, type RunData, type RunReader } from './run-data';

const reader = (r: RunReader): readonly string[] => ('admin' in r ? ['admin'] : ['member', r.member]);

export const benchQueries = {
  /** the bench as the admin sees it, every 5 s */
  status: (): LiveQuery<AdminView> => liveQuery(['test-bench', 'status'], getStatus, 5000),
  /** the runs the router keeps, every 15 s */
  runs: (r: RunReader): LiveQuery<RunSummary[]> =>
    liveQuery(['test-bench', ...reader(r), 'runs'], () => ('admin' in r ? getRuns() : memberRuns(r.session)), 15_000),
  /** a finished run, every part of it: it doesn't change, so it's read once */
  run: (r: RunReader, run: string): RouterQuery<RunData> => ({
    ...settingsQuery(['test-bench', ...reader(r), 'run', run], () => loadRun(r, run)),
    staleTime: Infinity,
  }),
};

/** A write to the bench (open, close, a new code, a run deleted, a member renamed…): the bench's reads are asked again once it went through. */
export function useBenchWrite<R = unknown>(): UseMutationResult<R, Error, () => Promise<R>> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (write: () => Promise<R>) => write(),
    onSuccess: () => client.invalidateQueries({ queryKey: ['test-bench'] }),
  });
}

/**
 * Reads a run once it's over (`ready`). A run that has just ended waits
 * `delayMs` first, while its members send what they still hold.
 */
export function useRunData(
  r: RunReader | undefined,
  run: string,
  ready: boolean,
  delayMs = 0,
): { data: RunData | undefined; error: string | undefined } {
  // the run waited for: a new run waits again
  const [waited, setWaited] = useState<string>();
  useEffect(() => {
    if (!ready || run === '' || delayMs === 0) return;
    const t = setTimeout(() => {
      setWaited(run);
    }, delayMs);
    return () => {
      clearTimeout(t);
    };
  }, [ready, run, delayMs]);
  const go = r !== undefined && ready && run !== '' && (delayMs === 0 || waited === run);
  const q = useQuery({ ...benchQueries.run(r ?? { admin: true }, run), enabled: go });
  return { data: go ? q.data : undefined, error: go && q.error !== null ? errorMessage(q.error) : undefined };
}
