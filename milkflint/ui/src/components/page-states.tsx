import { TriangleAlertIcon } from 'lucide-react';
import type { ReactElement } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/utils';

export function LoadError({ error, retry }: { error: unknown; retry: () => void }): ReactElement {
  return (
    <Alert variant="destructive">
      <TriangleAlertIcon />
      <AlertTitle>Couldn&apos;t load the settings</AlertTitle>
      <AlertDescription>
        {errorMessage(error)}
        <Button variant="outline" size="sm" onClick={retry} className="mt-2">
          Try again
        </Button>
      </AlertDescription>
    </Alert>
  );
}

export function FormSkeleton(): ReactElement {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-64 rounded-xl" />
      <Skeleton className="h-64 rounded-xl" />
    </div>
  );
}
