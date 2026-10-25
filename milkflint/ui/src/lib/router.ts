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

export function href(route: Route): string {
  return `#/${route}`;
}
