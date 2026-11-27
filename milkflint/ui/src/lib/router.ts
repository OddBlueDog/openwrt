// Where the app is: addresses live after "#" (the app is static files, so
// the web server needs no rewrite rules), read from TanStack Router's
// location (src/router.tsx has the routes). Route ids are the feature ids.
import { useRouterState } from '@tanstack/react-router';
import { type FeatureId, featureIds } from '@/features/ids';

export type Route = FeatureId;

function isRoute(value: string): value is Route {
  return (featureIds as readonly string[]).includes(value);
}

/** The address's parts after "#/": ['lan', 'addresses']. */
function parts(pathname: string): string[] {
  return pathname.replace(/^\/+/, '').split('/');
}

/** The feature an address shows: its first part, or Home when that names none. */
export function routeOf(pathname: string): Route {
  const name = parts(pathname)[0] ?? '';
  return isRoute(name) ? name : 'dashboard';
}

/** What follows the route's id: "join/abc" for #/test-bench/join/abc. */
export function subPathOf(pathname: string): string {
  return parts(pathname).slice(1).join('/');
}

const pathname = (state: { location: { pathname: string } }): string => state.location.pathname;

export function useRoute(): Route {
  return routeOf(useRouterState({ select: pathname }));
}

/** The first part of the address as written, route or not (for development-only pages). */
export function useRawRoute(): string {
  return parts(useRouterState({ select: pathname }))[0] ?? '';
}

export function useSubPath(): string {
  return subPathOf(useRouterState({ select: pathname }));
}

/** A page's address, or a part of it (a tab, a card it scrolls to), as text: #/logs, #/logs/radar. */
export function href(route: Route, sub?: string): string {
  return sub === undefined || sub === '' ? `#/${route}` : `#/${route}/${sub}`;
}

/** A page's address as link options: <Link {...pageLink('logs', 'radar')}>, navigate(pageLink(…)). */
export interface PageLink {
  to: '/$';
  params: { _splat: string };
}

/** The address href gives as text, as link options. */
export function pageLink(route: Route, sub?: string): PageLink {
  return { to: '/$', params: { _splat: sub === undefined || sub === '' ? route : `${route}/${sub}` } };
}

/** An address written as text (href's "#/logs/radar") as link options. */
export function addressLink(address: string): PageLink {
  return { to: '/$', params: { _splat: address.replace(/^#?\/*/, '') } };
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

/** tabHref as link options. */
export function tabLink<T extends string>(route: Route, tab: T, first: T): PageLink {
  return pageLink(route, tab === first ? undefined : tab);
}
