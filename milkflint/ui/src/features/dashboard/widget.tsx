// What Home's widgets share: the card with its heading (a plain icon before
// the title, from the same Lucide set as the menu), the link to the widget's
// page, the state dot, and the one-line note a widget shows while its feature
// is off.
import { ArrowDownIcon, ArrowUpIcon, ChevronRightIcon, type LucideIcon } from 'lucide-react';
import { type ReactElement, type ReactNode, useId } from 'react';
import { AskButton, AskPanel } from '@/components/on-request';
import { shown, useAsk, useDecorativeIcons, useOnRequest, useStateSymbols } from '@/lib/presentation';
import { Badge } from '@/components/ui/badge';
import { StateMark } from '@/components/ui/state-mark';
import { Card, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { Tone } from './model';

/** A widget's card: its icon and title, a few words beside it, and a badge or link on the right. */
export function Widget({
  icon: Icon,
  title,
  description,
  status,
  aside,
  className,
  children,
}: {
  /** what the widget is about, drawn quiet at the title's text size (so it follows a theme's type): not a tile */
  icon: LucideIcon;
  title: string;
  /** An explanation: behind a "?" when the theme keeps them on request. */
  description?: ReactNode;
  /** Live state: shown in every theme. */
  status?: ReactNode;
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
}): ReactElement {
  const id = useId();
  const icons = useDecorativeIcons();
  const onRequest = useOnRequest() && description !== undefined;
  const ask = useAsk();
  return (
    <Card aria-labelledby={id} className={cn('@container gap-4', className)}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <CardTitle id={id}>
            {icons && <Icon aria-hidden="true" className="mr-2 inline size-[1em] align-[-0.125em] text-muted-foreground" />}
            {title}
          </CardTitle>
          {onRequest && (
            <AskButton about={title} open={ask.open} onToggle={ask.toggle} controls={ask.panelId} className="self-center" />
          )}
          {description !== undefined && !onRequest && <p className="text-sm text-muted-foreground">{description}</p>}
          {shown(status) && <div className="text-sm text-muted-foreground">{status}</div>}
        </div>
        {aside !== undefined && <div className="flex shrink-0 items-center gap-3">{aside}</div>}
        {onRequest && (
          <AskPanel id={ask.panelId} open={ask.open} className="basis-full text-sm">
            {description}
          </AskPanel>
        )}
      </div>
      {children}
    </Card>
  );
}

/** To the widget's page. */
export function WidgetLink({ href, children }: { href: string; children: ReactNode }): ReactElement {
  return (
    <a href={href} className="inline-flex min-h-6 items-center gap-0.5 text-sm font-medium link">
      {children}
      <ChevronRightIcon className="size-4" aria-hidden="true" />
    </a>
  );
}

const dotTone: Record<Tone | 'off', string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  destructive: 'bg-destructive',
  info: 'bg-info',
  off: 'border border-muted-foreground bg-transparent',
};

const markTone = { warning: 'text-warning', destructive: 'text-destructive' } as const;

/** A state's dot, always beside its word: an empty ring when off; a "!" for trouble where the theme asks. */
export function Dot({ tone, className }: { tone: Tone | 'off'; className?: string }): ReactElement {
  const symbols = useStateSymbols();
  if (symbols && (tone === 'warning' || tone === 'destructive')) return <StateMark className={markTone[tone]} />;
  return <span aria-hidden="true" className={cn('inline-block size-2 shrink-0 rounded-full', dotTone[tone], className)} />;
}

/** The status badge in a widget's heading. */
export function StateBadge({ tone, children }: { tone: Tone | 'off'; children: ReactNode }): ReactElement {
  return tone === 'off' ? (
    <Badge variant="outline" className="text-muted-foreground">
      {children}
    </Badge>
  ) : (
    <Badge variant={tone}>{children}</Badge>
  );
}

/** In place of a widget's figures while its feature is off: what it does, and the way to it. */
export function OffNote({ children, action }: { children: ReactNode; action: ReactNode }): ReactElement {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 text-sm">
      <p className="text-muted-foreground">{children}</p>
      {action}
    </div>
  );
}

/** A label above its value. */
export function Figure({
  label,
  value,
  unit,
  tone,
  className,
}: {
  label: string;
  value: ReactNode;
  unit?: string | undefined;
  tone?: 'warning' | 'destructive' | undefined;
  className?: string;
}): ReactElement {
  return (
    <div className={cn('flex min-w-0 flex-col', className)}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          'text-base font-semibold tabular',
          tone === 'warning' && 'text-warning',
          tone === 'destructive' && 'text-destructive',
        )}
      >
        {value}
        {unit !== undefined && <span className="ml-0.5 text-sm font-normal text-muted-foreground">{unit}</span>}
      </dd>
    </div>
  );
}

/**
 * Down or up before a figure: an arrow at the text's size, and the word for
 * screen readers (the arrow carries the meaning).
 */
export function Way({ dir, className }: { dir: 'down' | 'up'; className?: string }): ReactElement {
  const Icon = dir === 'down' ? ArrowDownIcon : ArrowUpIcon;
  return (
    <>
      <Icon aria-hidden="true" className={cn('inline size-[1em] shrink-0 align-[-0.125em]', className)} />
      <span className="sr-only">{dir} </span>
    </>
  );
}
