import { CheckCircle2Icon, LoaderCircleIcon, TriangleAlertIcon, Undo2Icon } from 'lucide-react';
import { type ReactElement, useEffect, useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import type { ApplyState } from '@/hooks/use-apply';

/** What happened to the last save, shown above a page's form. */
export function ApplyStatus({ state }: { state: ApplyState }): ReactElement | null {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (state.phase !== 'applying') return undefined;
    const t = window.setInterval(() => {
      setNow(Date.now());
    }, 500);
    return () => {
      window.clearInterval(t);
    };
  }, [state.phase]);

  switch (state.phase) {
    case 'idle':
      return null;
    case 'applying':
      return (
        <Alert variant="info">
          <LoaderCircleIcon className="animate-spin" />
          <AlertTitle>Applying…</AlertTitle>
          <AlertDescription>
            {state.note !== undefined && <>{state.note} </>}
            The router is restarting what changed. If it can&apos;t be reached in{' '}
            {Math.max(0, Math.ceil((state.deadline - now) / 1000))} s, it undoes the change by itself.
          </AlertDescription>
        </Alert>
      );
    case 'done':
      return (
        <Alert variant="success">
          <CheckCircle2Icon />
          <AlertTitle>{state.nothingChanged ? 'Nothing to change' : 'Saved and applied'}</AlertTitle>
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
    case 'rolled-back':
      return (
        <Alert variant="warning">
          <Undo2Icon />
          <AlertTitle>The change was undone</AlertTitle>
          <AlertDescription>
            The router couldn&apos;t be reached after applying it, so it went back to the previous settings.
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
