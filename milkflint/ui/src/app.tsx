import { type ReactElement, Suspense } from 'react';
import { ErrorBoundary } from '@/components/error-boundary';
import { AppShell } from '@/components/layout/app-shell';
import { FormSkeleton } from '@/components/page-states';
import { RouterOnly } from '@/components/router-only';
import { TooltipProvider } from '@/components/ui/tooltip';
import { featureById } from '@/features';
import { LoginPage } from '@/pages/login';
import { useRoute } from '@/lib/router';
import { useRouterMode } from '@/lib/router-mode';
import { useSession } from '@/lib/session';

export function App(): ReactElement {
  const session = useSession();
  const route = useRoute();
  const routerMode = useRouterMode();

  if (session.status === 'anonymous') return <LoginPage reason={session.reason} />;

  const feature = featureById(route);
  const Page = feature.page;
  return (
    <TooltipProvider delayDuration={200}>
      <AppShell route={route}>
        <ErrorBoundary resetKey={route}>
          <Suspense fallback={<FormSkeleton />}>
            {routerMode === 'ap' && feature.routerOnly === true ? <RouterOnly feature={feature} /> : <Page />}
          </Suspense>
        </ErrorBoundary>
      </AppShell>
    </TooltipProvider>
  );
}
