import type { LucideIcon } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import { AskButton, AskPanel } from '@/components/on-request';
import { shown, useAsk, useOnRequest } from '@/lib/presentation';
import { CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * The standard card header: title, one-line description, optional action on
 * the right. Cards no longer wear an icon tile; `icon` is accepted so callers
 * needn't change, and is left out of the drawing. The description is an
 * explanation (behind a "?" when the theme keeps them on request); live state
 * goes in `status`, which always shows.
 */
export function CardHeading({
  title,
  description,
  status,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  status?: ReactNode;
  action?: ReactNode;
}): ReactElement {
  const onRequest = useOnRequest() && description !== undefined;
  const ask = useAsk();
  return (
    <CardHeader className="flex-wrap items-start justify-between gap-x-4 gap-y-2">
      <div className="flex min-w-0 flex-col gap-0.5">
        {onRequest ? (
          <div className="flex items-center gap-2">
            <CardTitle>{title}</CardTitle>
            <AskButton about={title} open={ask.open} onToggle={ask.toggle} controls={ask.panelId} />
          </div>
        ) : (
          <CardTitle>{title}</CardTitle>
        )}
        {description !== undefined && !onRequest && <CardDescription>{description}</CardDescription>}
        {shown(status) && <div className="text-sm text-muted-foreground">{status}</div>}
        {onRequest && (
          <AskPanel id={ask.panelId} open={ask.open} className="text-sm">
            {description}
          </AskPanel>
        )}
      </div>
      {action !== undefined && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </CardHeader>
  );
}

/** A label/value row in a key-value list. */
export function InfoRow({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b py-2.5 text-sm last:border-b-0">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right font-medium tabular">{children}</span>
    </div>
  );
}
