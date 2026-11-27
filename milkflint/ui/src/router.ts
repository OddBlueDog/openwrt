// The app's routes, over hash history so every address stays after "#"
// (#/lan, #/lan/addresses) as before. One route shows every feature page:
// its splat is the address (feature id, then the sub-path a page reads for
// its tab), so a tab change never remounts the page. The test bench's join
// page is the one address outside the sign-in gate and the shell.
import type { QueryClient } from '@tanstack/react-query';
import {
  createHashHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  type RouterHistory,
} from '@tanstack/react-router';
import { App, Join } from './app';
import { featureById } from './features';
import { routeOf } from './lib/router';
import { signedIn } from './lib/session';

export interface RouterContext {
  queryClient: QueryClient;
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: Outlet,
});

const joinRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'test-bench/join/$',
  component: Join,
});

const pageRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '$',
  loader: ({ context, location }) => {
    // signed out, the page waits behind the sign-in: a read now would only be
    // refused, and the refusal kept in the cache would greet the page after it
    if (!signedIn()) return;
    featureById(routeOf(location.pathname)).prefetch?.(context.queryClient);
  },
  component: App,
});

const routeTree = rootRoute.addChildren([joinRoute, pageRoute]);

const makeRouter = (queryClient: QueryClient, history: RouterHistory) =>
  createRouter({
    routeTree,
    history,
    context: { queryClient },
    defaultPreload: 'intent',
    // the page's own data decides freshness (TanStack Query): the router keeps no loader cache
    defaultPreloadStaleTime: 0,
  });

export type AppRouter = ReturnType<typeof makeRouter>;

/** The app's router; a test gives it another history (createMemoryHistory). */
export function createAppRouter(queryClient: QueryClient, history?: RouterHistory): AppRouter {
  return makeRouter(queryClient, history ?? createHashHistory());
}

declare module '@tanstack/react-router' {
  interface Register {
    router: AppRouter;
  }
}
