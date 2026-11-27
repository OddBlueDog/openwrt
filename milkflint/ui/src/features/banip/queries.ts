// What the banIP page reads and writes (see ARCHITECTURE.md). Every write
// goes through useBanipWrite, which refreshes all of banIP's reads once it
// went through: the status, the config and the lists.
import { useMutation, type UseMutationResult, useQueryClient } from '@tanstack/react-query';
import { getHostHints, type HostHints } from '@/lib/api/network';
import { type LiveQuery, liveQuery, type RouterQuery, settingsQuery } from '@/lib/query/options';
import {
  type BanipConfig,
  type BanipStatus,
  type DropFilter,
  type Drops,
  getConfig,
  getDrops,
  getList,
  getMail,
  getProcessingLog,
  getStatus,
  type ListName,
  type MailAccount,
} from './api';

export const banipQueries = {
  /** what banIP is doing, every 3 s; Home's widgets read it too */
  status: (): LiveQuery<BanipStatus> => liveQuery(['banip', 'status'], getStatus, 3000),
  /** the same read for Home's note, every 30 s: one cache with the page's */
  statusEvery30s: (): LiveQuery<BanipStatus> => liveQuery(['banip', 'status'], getStatus, 30_000),
  config: (): RouterQuery<BanipConfig> => settingsQuery(['banip', 'config'], getConfig),
  list: (list: ListName): RouterQuery<Awaited<ReturnType<typeof getList>>> =>
    settingsQuery(['banip', 'list', list], () => getList(list)),
  /** a page of the blocked connections recorded, every 15 s */
  drops: (offset: number, limit: number, filter: DropFilter): LiveQuery<Drops> =>
    liveQuery(['banip', 'drops', offset, limit, filter], () => getDrops(offset, limit, filter), 15_000),
  /** names for devices' addresses (an empty set when the router has none) */
  hostHints: (): RouterQuery<HostHints> =>
    settingsQuery(['banip', 'host-hints'], () => getHostHints().catch((): HostHints => ({}))),
  /** the mail account banIP's reports go out with (msmtp's) */
  mail: (): RouterQuery<MailAccount> => settingsQuery(['banip', 'mail'], getMail),
  /** banIP's own log, every 10 s while it's shown */
  processingLog: (): LiveQuery<Awaited<ReturnType<typeof getProcessingLog>>> =>
    liveQuery(['banip', 'processing-log'], () => getProcessingLog(300), 10_000),
};

/**
 * A write to banIP (`mutate(() => saveOptions(…))`): once it went through,
 * every banIP read is asked again. Its error is the caller's to show.
 */
export function useBanipWrite<R = unknown>(): UseMutationResult<R, Error, () => Promise<R>> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (write: () => Promise<R>) => write(),
    onSuccess: () => client.invalidateQueries({ queryKey: ['banip'] }),
  });
}

/** Ask banIP's reads again (after a change made elsewhere: a package update). */
export function useBanipRefresh(): () => void {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: ['banip'] });
  };
}
