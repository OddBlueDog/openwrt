// The query cache for the tree below, emptied whenever the session ends
// (signing out, or the router no longer knowing the session): nothing read
// with it, a Wi-Fi or VPN key say, outlives it in the tab.
import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactElement, type ReactNode, useEffect } from 'react';
import { onSignedOut } from '@/lib/session';

export function QueryProvider({ client, children }: { client: QueryClient; children: ReactNode }): ReactElement {
  useEffect(
    () =>
      onSignedOut(() => {
        client.clear();
      }),
    [client],
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
