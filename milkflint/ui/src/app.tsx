import { type ReactElement, Suspense } from 'react';
import { ErrorBoundary } from '@/components/error-boundary';
import { AppShell } from '@/components/layout/app-shell';
import { FormSkeleton } from '@/components/page-states';
import { TooltipProvider } from '@/components/ui/tooltip';
import { featureById } from '@/features';
import { LoginPage } from '@/pages/login';
import { useRoute } from '@/lib/router';
import { useSession } from '@/lib/session';

export function App(): ReactElement {
  const session = useSession();
  const route = useRoute();

  if (session.status === 'anonymous') return <LoginPage reason={session.reason} />;

  const Page = featureById(route).page;
  return (
    <TooltipProvider delayDuration={200}>
      <AppShell route={route}>
        <ErrorBoundary resetKey={route}>
          <Suspense fallback={<FormSkeleton />}>
            <Page />
          </Suspense>
        </ErrorBoundary>
      </AppShell>
    </TooltipProvider>
  );
}
