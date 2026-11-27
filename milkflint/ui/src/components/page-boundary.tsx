// Where a page waits for the data it can't draw without (useSuspenseQuery):
// the skeleton while it loads, and "Couldn't load the settings" with a retry
// when it fails. A refresh that fails once the data is there doesn't land
// here: the page keeps showing what it has.
import { QueryErrorResetBoundary } from '@tanstack/react-query';
import { type ReactElement, type ReactNode, Suspense } from 'react';
import { ErrorBoundary } from '@/components/error-boundary';
import { FormSkeleton, LoadError } from '@/components/page-states';

export function PageBoundary({
  children,
  fallback,
}: {
  children: ReactNode;
  /** What shows while loading; the settings skeleton when left out. */
  fallback?: ReactNode;
}): ReactElement {
  return (
    <QueryErrorResetBoundary>
      {({ reset }) => (
        <ErrorBoundary
          fallback={(error, retry) => (
            <LoadError
              error={error}
              retry={() => {
                reset();
                retry();
              }}
            />
          )}
        >
          <Suspense fallback={fallback ?? <FormSkeleton />}>{children}</Suspense>
        </ErrorBoundary>
      )}
    </QueryErrorResetBoundary>
  );
}
