// A small hash router: the app is static files, so routes live after "#" and
// the web server needs no rewrite rules. Route ids are the feature ids.
import { useSyncExternalStore } from 'react';
import { type FeatureId, featureIds } from '@/features/ids';

export type Route = FeatureId;

function isRoute(value: string): value is Route {
  return (featureIds as readonly string[]).includes(value);
}

function current(): Route {
  const name = window.location.hash.replace(/^#\/?/, '').split('/')[0] ?? '';
  return isRoute(name) ? name : 'dashboard';
}

function subscribe(listener: () => void): () => void {
  window.addEventListener('hashchange', listener);
  return () => {
    window.removeEventListener('hashchange', listener);
  };
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, current);
}

/** The first part of the hash as written, route or not (for development-only pages). */
function rawName(): string {
  return window.location.hash.replace(/^#\/?/, '').split('/')[0] ?? '';
}

export function useRawRoute(): string {
  return useSyncExternalStore(subscribe, rawName);
}

/** What follows the route's id: "join/abc" for #/test-bench/join/abc. */
function subPath(): string {
  return window.location.hash.replace(/^#\/?/, '').split('/').slice(1).join('/');
}

export function useSubPath(): string {
  return useSyncExternalStore(subscribe, subPath);
}

/** A page's address, or a part of it (a tab, a card it scrolls to): #/logs, #/logs/radar. */
export function href(route: Route, sub?: string): string {
  return sub === undefined || sub === '' ? `#/${route}` : `#/${route}/${sub}`;
}

/** A page's tab, from what follows its id in the address; its first tab when that names none. */
export function tabFrom<T extends string>(sub: string, tabs: readonly { id: T }[], first: T): T {
  const name = sub.split('/')[0] ?? '';
  return tabs.find((t) => t.id === name)?.id ?? first;
}

/** Where a page's tab lives: the page's own address for its first tab, #/<route>/<tab> for the others. */
export function tabHref<T extends string>(route: Route, tab: T, first: T): string {
  return href(route, tab === first ? undefined : tab);
}
