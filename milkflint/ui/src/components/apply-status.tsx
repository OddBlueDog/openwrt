import { CheckCircle2Icon, LoaderCircleIcon, TriangleAlertIcon, XIcon } from 'lucide-react';
import { type ReactElement, type ReactNode, useEffect, useState } from 'react';
import type { ApplyState } from '@/hooks/use-apply';
import { cn } from '@/lib/utils';

/** How long "Saved and applied" stays before it goes. Errors and moves stay until dismissed. */
const DONE_MS = 6000;

function Toast({
  tone,
  icon,
  title,
  children,
  onClose,
}: {
  tone: 'info' | 'success' | 'destructive';
  icon: ReactNode;
  title: string;
  children?: ReactNode;
  onClose?: () => void;
}): ReactElement {
  return (
    <div
      role={tone === 'destructive' ? 'alert' : 'status'}
      className={cn(
        'pointer-events-auto flex w-full animate-[mf-toast-in_var(--mf-duration-base)_var(--mf-ease-enter)] items-start gap-3 rounded-xl border bg-popover px-4 py-3 text-sm text-popover-foreground shadow-lg sm:w-96',
        tone === 'destructive' && 'border-destructive/40',
      )}
    >
      <span
        className={cn(
          'mt-0.5 shrink-0 [&>svg]:size-4',
          tone === 'success' ? 'text-success' : tone === 'destructive' ? 'text-destructive' : 'text-info',
        )}
      >
        {icon}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="font-semibold">{title}</p>
        {children !== undefined && <div className="text-foreground">{children}</div>}
      </div>
      {onClose !== undefined && (
        <button
          type="button"
          onClick={onClose}
          aria-label="Dismiss"
          className="-mt-1 -mr-2 flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <XIcon className="size-4" />
        </button>
      )}
    </div>
  );
}

/**
 * What happened to the last save, as a toast at the bottom of the screen,
 * beside where Save was pressed, however long the page. A page renders it
 * anywhere; it places itself.
 */
export function ApplyStatus({ state }: { state: ApplyState }): ReactElement | null {
  const [hidden, setHidden] = useState<ApplyState | undefined>(undefined);
  useEffect(() => {
    if (state.phase !== 'done') return;
    const timer = window.setTimeout(() => {
      setHidden(state);
    }, DONE_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [state]);
  if (state.phase === 'idle' || hidden === state) return null;
  const close = (): void => {
    setHidden(state);
  };

  let toast: ReactElement;
  switch (state.phase) {
    case 'applying':
      toast = <Toast tone="info" icon={<LoaderCircleIcon className="animate-spin" />} title="Applying…" />;
      break;
    case 'done':
      toast = (
        <Toast
          tone="success"
          icon={<CheckCircle2Icon />}
          title={state.nothingChanged ? 'Nothing to change' : 'Saved and applied'}
          onClose={close}
        >
          {state.note}
        </Toast>
      );
      break;
    case 'moved':
      toast = (
        <Toast tone="info" icon={<CheckCircle2Icon />} title="The router is moving to its new address">
          Reconnect your device if needed (unplug and replug the cable, or rejoin the Wi-Fi), then open{' '}
          <a href={state.url} className="font-medium text-primary underline">
            {state.url}
          </a>
          .
        </Toast>
      );
      break;
    case 'failed':
      toast = (
        <Toast tone="destructive" icon={<TriangleAlertIcon />} title="Couldn’t save" onClose={close}>
          {state.message}
        </Toast>
      );
      break;
  }
  return <div className="pointer-events-none fixed inset-x-4 bottom-4 z-40 flex justify-end sm:inset-x-6">{toast}</div>;
}
