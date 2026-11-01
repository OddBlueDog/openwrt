import { CheckCircle2Icon, LoaderCircleIcon, TriangleAlertIcon } from 'lucide-react';
import type { ReactElement } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import type { ApplyState } from '@/hooks/use-apply';

/** What happened to the last save, shown above a page's form. */
export function ApplyStatus({ state }: { state: ApplyState }): ReactElement | null {
  switch (state.phase) {
    case 'idle':
      return null;
    case 'applying':
      return (
        <Alert variant="info">
          <LoaderCircleIcon className="animate-spin" />
          <AlertTitle>Applying…</AlertTitle>
        </Alert>
      );
    case 'done':
      return (
        <Alert variant="success">
          <CheckCircle2Icon />
          <AlertTitle>{state.nothingChanged ? 'Nothing to change' : 'Saved and applied'}</AlertTitle>
          {state.note !== undefined && <AlertDescription>{state.note}</AlertDescription>}
        </Alert>
      );
    case 'moved':
      return (
        <Alert variant="info">
          <CheckCircle2Icon />
          <AlertTitle>The router is moving to its new address</AlertTitle>
          <AlertDescription>
            Reconnect your device if needed (unplug and replug the cable, or rejoin the Wi-Fi), then open{' '}
            <a href={state.url} className="font-medium text-primary underline">
              {state.url}
            </a>
            .
          </AlertDescription>
        </Alert>
      );
    case 'failed':
      return (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>Couldn&apos;t save</AlertTitle>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      );
  }
}
