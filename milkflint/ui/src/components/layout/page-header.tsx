import type { ReactElement, ReactNode } from 'react';
import { AskButton, AskPanel } from '@/components/on-request';
import { shown, useAsk, useOnRequest } from '@/lib/presentation';

export function PageHeader({
  title,
  description,
  status,
  actions,
}: {
  title: string;
  /** What the page is for: behind a "?" when the theme keeps explanations on request. */
  description?: ReactNode;
  /** Live state about the page (a device, the router): shown in every theme. */
  status?: ReactNode;
  actions?: ReactNode;
}): ReactElement {
  const onRequest = useOnRequest() && description !== undefined;
  const ask = useAsk();
  return (
    <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 pb-6">
      <div className="min-w-0">
        <div className="flex items-center gap-2.5">
          <h1 className="text-2xl font-semibold tracking-tight text-balance">{title}</h1>
          {onRequest && <AskButton about={title} open={ask.open} onToggle={ask.toggle} controls={ask.panelId} />}
        </div>
        {description !== undefined && !onRequest && (
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">{description}</p>
        )}
        {shown(status) && <div className="mt-1 max-w-prose text-sm text-muted-foreground">{status}</div>}
        {onRequest && (
          <AskPanel id={ask.panelId} open={ask.open} className="mt-2 text-sm">
            {description}
          </AskPanel>
        )}
      </div>
      {/* top right beside the title, below it on a phone */}
      {actions !== undefined && <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
