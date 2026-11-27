// A live query with the shape usePoll gave pages: the data, the last error,
// a refresh, and when it last answered and will ask next (for Freshness).
import { focusManager, type QueryKey, useQuery } from '@tanstack/react-query';
import { useCallback, useSyncExternalStore } from 'react';
import type { LiveQuery } from './options';

export interface Live<T> {
  data: T | undefined;
  error: unknown;
  /** Nothing to show yet: no answer and no error. */
  loading: boolean;
  refresh: () => void;
  /** When it last answered, epoch ms; undefined until it has. */
  at?: number | undefined;
  /** When it will ask next, epoch ms; undefined while the tab is hidden or before the first answer or error. */
  next?: number | undefined;
}

const subscribeFocus = (listener: () => void): (() => void) => focusManager.subscribe(listener);
const focused = (): boolean => focusManager.isFocused();

export function useLive<T, K extends QueryKey>(options: LiveQuery<T, K>): Live<T> {
  const query = useQuery(options);
  const visible = useSyncExternalStore(subscribeFocus, focused);
  const { refetch } = query;
  const refresh = useCallback(() => {
    void refetch();
  }, [refetch]);
  const at = query.dataUpdatedAt === 0 ? undefined : query.dataUpdatedAt;
  const last = Math.max(query.dataUpdatedAt, query.errorUpdatedAt);
  const delay = typeof options.every === 'number' ? options.every : options.every(query.data);
  return {
    data: query.data,
    error: query.error ?? undefined,
    loading: query.data === undefined && query.error === null,
    refresh,
    at,
    next: !visible || last === 0 ? undefined : last + delay,
  };
}
