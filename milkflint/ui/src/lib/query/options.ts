// The three kinds of router read (see ARCHITECTURE.md). A feature's
// queries.ts builds each of its reads with one of these, so how often a
// page asks the router is decided here, not page by page.
import { type QueryKey, type QueryKeyWithDataTag, queryOptions, type UnusedSkipTokenOptions } from '@tanstack/react-query';

/**
 * What a query factory returns: options for useQuery, useSuspenseQuery and
 * the client, with the data's type in the key. Keys are typed as QueryKey,
 * so a factory's return type is just RouterQuery<Data>.
 */
export type RouterQuery<T, K extends QueryKey = QueryKey> = UnusedSkipTokenOptions<T, Error, T, K> & QueryKeyWithDataTag<K, T>;

/** How often a live read asks again: a fixed delay, or one worked out from the last answer. */
export type Every<T> = number | ((data: T | undefined) => number);

/** A live read: a query that asks again every `every` ms, and says how often (for useLive's `next`). */
export type LiveQuery<T, K extends QueryKey = QueryKey> = RouterQuery<T, K> & { every: Every<T> };

/** How old a settings read may be and still be used as is when a page mounts. */
export const SETTINGS_FRESH_MS = 5_000;

/**
 * Settings a page edits: read when the page mounts and after a save
 * (invalidation), never on a timer or on the tab coming back, so it never
 * changes under the user's hands. A read a few seconds old is used as is
 * when the page mounts: the one its route started while the page's code
 * loaded, or on hovering its link, isn't made twice.
 */
export function settingsQuery<T>(key: QueryKey, load: () => Promise<T>): RouterQuery<T> {
  return queryOptions({ queryKey: key, queryFn: load, refetchOnWindowFocus: false, staleTime: SETTINGS_FRESH_MS });
}

/**
 * What the router is doing now: asked again every `every` ms while the tab
 * is visible, and straight away when it shows again. A failed refresh keeps
 * the last answer (and sets the error). Calls for one key never overlap:
 * a refresh due while one is on its way waits for it.
 */
export function liveQuery<T>(key: QueryKey, load: () => Promise<T>, every: Every<T>): LiveQuery<T> {
  const options = queryOptions({
    queryKey: key,
    queryFn: load,
    refetchInterval: typeof every === 'number' ? every : (query) => every(query.state.data),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
  return { ...options, every };
}

/** What doesn't change while the router runs (its board, its built-in ports): read once a session. */
export function staticQuery<T>(key: QueryKey, load: () => Promise<T>): RouterQuery<T> {
  return queryOptions({ queryKey: key, queryFn: load, staleTime: Infinity, gcTime: Infinity });
}
