// The router's data in the browser: one TanStack Query cache for every page
// (see ARCHITECTURE.md). The defaults fit a router rather than a web service:
// nothing retries (a poll comes round again anyway, and a rebooting router
// shouldn't be hammered), and nothing waits for the browser to say it's
// online, because the router is often the very network that just dropped
// (a Wi-Fi save) and navigator.onLine would pause every query and save.
import { QueryClient } from '@tanstack/react-query';

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        networkMode: 'always',
        refetchOnReconnect: false,
        staleTime: 0,
      },
      mutations: {
        retry: false,
        networkMode: 'always',
      },
    },
  });
}

/** The app's cache. Tests make their own with createQueryClient(). */
export const queryClient: QueryClient = createQueryClient();
