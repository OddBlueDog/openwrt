// What the Network quality page (and Home's widgets) read (see ARCHITECTURE.md).
import { type QueryClient, type QueryKey, queryOptions } from '@tanstack/react-query';
import { type LiveQuery, liveQuery, type RouterQuery, settingsQuery } from '@/lib/query/options';
import { getHistory, getStatus, type History, loadSettings } from './api';
import type { Live } from './live';
import type { QualityForm } from './model';
import { possibleSample } from './plausible';

const LIVE_KEY: QueryKey = ['network-quality', 'live'];

/** The next answer: the status, and the samples held so far with the new ones added and those over an hour old dropped. */
async function readLive(client: QueryClient): Promise<Live> {
  const held = client.getQueryData<Live>(LIVE_KEY)?.samples ?? [];
  const status = await getStatus(held[held.length - 1]?.t ?? 0);
  const cutoff = status.now - 3600;
  // only what's newer than what's held now: another read may have got there first
  const now = client.getQueryData<Live>(LIVE_KEY)?.samples ?? held;
  const newest = now[now.length - 1]?.t ?? 0;
  const samples = [...now, ...status.samples.filter((s) => s.t > newest && possibleSample(s))].filter((s) => s.t > cutoff);
  return { status, samples };
}

export const qualityQueries = {
  settings: (): RouterQuery<QualityForm> => settingsQuery(['network-quality', 'settings'], loadSettings),
  /**
   * The probe's last hour, asked again every `intervalMs` (the shortest any
   * reader asks for wins); each read asks only for samples newer than those
   * it holds.
   */
  live: (intervalMs: number): LiveQuery<Live> => ({
    ...queryOptions({
      queryKey: LIVE_KEY,
      queryFn: ({ client }) => readLive(client),
      refetchInterval: intervalMs,
      refetchIntervalInBackground: false,
      refetchOnWindowFocus: true,
    }),
    every: intervalMs,
  }),
  /** a longer span's buckets, every minute */
  history: (seconds: number, step: number): LiveQuery<History> =>
    liveQuery(['network-quality', 'history', seconds, step], () => getHistory(seconds, step), 60_000),
};
