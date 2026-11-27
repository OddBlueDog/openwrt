import { RouterProvider } from '@tanstack/react-router';
import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { queryClient } from './lib/query/client';
import { QueryProvider } from './lib/query/provider';
import { createAppRouter } from './router';
import 'virtual:milkflint-themes.css';
import './styles.css';

// development only: the query cache's and the router's own panels; left out of production builds
const QueryDevtools = import.meta.env.DEV
  ? lazy(() => import('@tanstack/react-query-devtools').then((m) => ({ default: m.ReactQueryDevtools })))
  : null;
const RouterDevtools = import.meta.env.DEV
  ? lazy(() => import('@tanstack/react-router-devtools').then((m) => ({ default: m.TanStackRouterDevtools })))
  : null;

const router = createAppRouter(queryClient);

const root = document.getElementById('root');
if (root === null) throw new Error('missing #root');

createRoot(root).render(
  <StrictMode>
    <QueryProvider client={queryClient}>
      <RouterProvider router={router} />
      {QueryDevtools !== null && RouterDevtools !== null && (
        <Suspense fallback={null}>
          <QueryDevtools buttonPosition="bottom-left" />
          <RouterDevtools router={router} position="bottom-right" />
        </Suspense>
      )}
    </QueryProvider>
  </StrictMode>,
);
