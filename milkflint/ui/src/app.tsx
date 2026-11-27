import { lazy, type ReactElement, Suspense } from 'react';
import { ErrorBoundary } from '@/components/error-boundary';
import { AppShell } from '@/components/layout/app-shell';
import { FormSkeleton } from '@/components/page-states';
import { RouterOnly } from '@/components/router-only';
import { TooltipProvider } from '@/components/ui/tooltip';
import { featureById } from '@/features';
import { LoginPage } from '@/pages/login';
import { useRawRoute, useRoute } from '@/lib/router';
import { useRouterMode } from '@/lib/router-mode';
import { useSession } from '@/lib/session';

// a test bench's page for the devices that join it: no admin sign-in
const JoinPage = lazy(() => import('@/features/test-bench/join-page').then((m) => ({ default: m.JoinPage })));

/** #/test-bench/join/<code>: outside the sign-in gate and the shell. */
export function Join(): ReactElement {
  return (
    <Suspense fallback={null}>
      <JoinPage />
    </Suspense>
  );
}

// development only (#/specimen): every theme token and component; left out of production builds
const Specimen = import.meta.env.DEV ? lazy(() => import('@/dev/specimen').then((m) => ({ default: m.SpecimenPage }))) : null;

export function App(): ReactElement {
  const session = useSession();
  const route = useRoute();
  const routerMode = useRouterMode();
  const raw = useRawRoute();

  if (Specimen !== null && raw === 'specimen') {
    return (
      <TooltipProvider delayDuration={200}>
        <Suspense fallback={null}>
          <Specimen />
        </Suspense>
      </TooltipProvider>
    );
  }

  if (session.status === 'anonymous') return <LoginPage reason={session.reason} />;

  const feature = featureById(route);
  const Page = feature.page;
  return (
    <TooltipProvider delayDuration={200}>
      <AppShell route={route} title={feature.title}>
        <ErrorBoundary resetKey={route}>
          <Suspense fallback={<FormSkeleton />}>
            {routerMode === 'ap' && feature.routerOnly === true ? <RouterOnly feature={feature} /> : <Page />}
          </Suspense>
        </ErrorBoundary>
      </AppShell>
    </TooltipProvider>
  );
}
