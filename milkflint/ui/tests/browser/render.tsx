// Drawing a component the way the app does: inside a query cache and a
// router of its own (fresh for each test, so no test sees another's data),
// on hash history at the address the test set (window.location.hash). The
// router's one page route draws what the test renders; the providers are
// render's wrapper, so a rerender keeps them.
import type { QueryClient } from '@tanstack/react-query';
import { createHashHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router';
import { createContext, type ReactElement, type ReactNode, use } from 'react';
import { render, type RenderResult } from 'vitest-browser-react';
import { createQueryClient } from '@/lib/query/client';
import { QueryProvider } from '@/lib/query/provider';

const Drawn = createContext<ReactNode>(null);

function Page(): ReactNode {
  return use(Drawn);
}

function testRouter() {
  const root = createRootRoute({ component: Outlet });
  const page = createRoute({ getParentRoute: () => root, path: '$', component: Page });
  return createRouter({ routeTree: root.addChildren([page]), history: createHashHistory() });
}

export async function renderWithProviders(
  ui: ReactElement,
  { path }: { path?: string } = {},
): Promise<RenderResult & { client: QueryClient }> {
  if (path !== undefined) window.location.hash = `#${path}`;
  const client = createQueryClient();
  const router = testRouter();
  await router.load();
  const wrapper = ({ children }: { children: ReactNode }): ReactElement => (
    <QueryProvider client={client}>
      <Drawn value={children}>
        <RouterProvider router={router} />
      </Drawn>
    </QueryProvider>
  );
  const screen = await render(ui, { wrapper });
  return Object.assign(screen, { client });
}
