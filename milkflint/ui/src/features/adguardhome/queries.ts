// What the AdGuard Home page reads and writes (see ARCHITECTURE.md). Every
// write, its own sign-in included, goes through useAdGuardWrite, which asks
// the status again once it went through.
import { useMutation, type UseMutationResult, useQueryClient } from '@tanstack/react-query';
import { getHostHints, type HostHints } from '@/lib/api/network';
import { type LiveQuery, liveQuery, type RouterQuery, settingsQuery } from '@/lib/query/options';
import { type Live, useLive } from '@/lib/query/use-live';
import { type AdGuardInsights, type AdGuardStatus, type Around, getAdGuardInsights, getAdGuardStatus, loadAround } from './api';
import { namesByAddress, windowText } from './model';

/** How often the page reads the figures: AdGuard Home counts by the hour, so a minute shows each change soon enough. */
export const INSIGHTS_MS = 60_000;
/** Names change rarely: the host hints every five minutes. */
const HINTS_MS = 300_000;

export const adguardQueries = {
  /** what AdGuard Home is doing, every 5 s */
  /** every 5 s on its page, or at the reader's own pace (Home: 30 s) */
  status: (every = 5000): LiveQuery<AdGuardStatus> => liveQuery(['adguardhome', 'status'], getAdGuardStatus, every),
  /** the same read for Home's note, every 15 s: one cache with the page's */
  statusEvery15s: (): LiveQuery<AdGuardStatus> => liveQuery(['adguardhome', 'status'], getAdGuardStatus, 15_000),
  around: (): RouterQuery<Around> => settingsQuery(['adguardhome', 'around'], loadAround),
  insights: (): LiveQuery<AdGuardInsights> => liveQuery(['adguardhome', 'insights'], getAdGuardInsights, INSIGHTS_MS),
  hostHints: (): LiveQuery<HostHints> => liveQuery(['adguardhome', 'host-hints'], getHostHints, HINTS_MS),
};

/** A write to AdGuard Home (`mutateAsync(() => enableAdGuard(true))`): its status is asked again once it went through. */
export function useAdGuardWrite<R = unknown>(): UseMutationResult<R, Error, () => Promise<R>> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (write: () => Promise<R>) => write(),
    onSuccess: () => client.invalidateQueries({ queryKey: ['adguardhome'] }),
  });
}

export type Insights = Live<AdGuardInsights> & {
  /** it's giving figures */
  ready: boolean;
  /** its window in words ("24 hours"), once it's giving figures */
  span: string | undefined;
  /** the router's names for devices, by address */
  names: Map<string, string>;
};

/** The figures and the names for its devices: one read for the page's card and Home's widget. */
export function useInsights(): Insights {
  const live = useLive(adguardQueries.insights());
  const hints = useLive(adguardQueries.hostHints());
  const { data } = live;
  const ready = data !== undefined && data.running && data.error === undefined && data.at !== undefined;
  const slots = data?.queries?.length ?? 0;
  const span = ready && slots > 0 ? windowText(slots, data.unit) : undefined;
  return { ...live, ready, span, names: namesByAddress(hints.data ?? {}) };
}
