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
import { useFit } from './fit';
import type { Tone } from './model';
import { useWidgetInfo } from './widget-info';

/**
 * A widget's card: its icon and title, a few words beside it, and a badge or
 * link on the right. It fills the cell Home gives it, and never more: its
 * body is a box (fit.ts) whose parts marked `data-fit` go when there isn't
 * room for them; the part that can grow (a chart) takes `flex-1` so no blank
 * band is left at its foot.
 */
export function Widget({
  icon,
  title,
  description,
  status,
  aside,
  className,
  children,
}: {
  /**
   * What the widget is about, drawn quiet at the title's text size (so it
   * follows a theme's type), not a tile; with the title, the registry's
   * unless the card says otherwise (the internet's is the main router's in
   * access point mode).
   */
  icon?: LucideIcon;
  title?: string;
  /** An explanation: behind a "?" when the theme keeps them on request. */
  description?: ReactNode;
  /** Live state: shown in every theme. */
  status?: ReactNode;
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
}): ReactElement {
  const id = useId();
  const info = useWidgetInfo();
  const Icon = icon ?? info.icon;
  const heading = title ?? info.title;
  const icons = useDecorativeIcons();
  const onRequest = useOnRequest() && description !== undefined;
  const ask = useAsk();
  const body = useFit<HTMLDivElement>();
  return (
    <Card aria-labelledby={id} className={cn('@container h-full gap-4', className)}>
      {/* one narrow column: the title's group lets its parts into this row, so the badge and arrow sit beside the
          title and the few words go on the line under it, rather than the arrow on a line of its own */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5 narrow:contents">
          <CardTitle id={id} className="narrow:order-1">
            {icons && <Icon aria-hidden="true" className="mr-2 inline size-[1em] align-[-0.125em] text-muted-foreground" />}
            {heading}
          </CardTitle>
          {onRequest && (
            <AskButton
              about={heading}
              open={ask.open}
              onToggle={ask.toggle}
              controls={ask.panelId}
              // beside the title: the room left in the row goes after it, not either side of it
              className="self-center narrow:order-1 narrow:mr-auto"
            />
          )}
          {description !== undefined && !onRequest && (
            <p className="text-sm text-muted-foreground narrow:order-3 narrow:basis-full">{description}</p>
          )}
          {shown(status) && <div className="text-sm text-muted-foreground narrow:order-3 narrow:basis-full">{status}</div>}
        </div>
        {aside !== undefined && (
          <div data-slot="widget-aside" className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 narrow:order-2">
            {aside}
          </div>
        )}
        {onRequest && (
          <AskPanel id={ask.panelId} open={ask.open} className="basis-full text-sm narrow:order-4">
            {description}
          </AskPanel>
        )}
      </div>
      <div {...body} className="flex min-h-0 flex-1 flex-col gap-4">
        {children}
      </div>
    </Card>
  );
}

/** To the widget's page, or to where its feature is turned on. */
export function WidgetLink({ href, children }: { href: string; children: ReactNode }): ReactElement {
  return (
    // one narrow column: in the heading, the arrow alone (its words stay for screen readers), so the heading keeps
    // to its lines; in the widget's body (the way to a feature that's off) the words are what it's for, and stay
    <a href={href} className="inline-flex min-h-6 min-w-6 items-center justify-center gap-0.5 text-sm font-medium link">
      <span className="narrow:in-data-[slot=widget-aside]:sr-only">{children}</span>
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

/**
 * In place of a widget's figures while its feature is off: what it does, and
 * the way to it, in the middle of the height the widget has.
 */
export function OffNote({ children, action }: { children: ReactNode; action: ReactNode }): ReactElement {
  return (
    <div className="flex flex-1 flex-wrap content-center items-center justify-between gap-x-4 gap-y-2 px-5 text-sm">
      {/* the explanation goes before the way to it, when the widget is short of room */}
      <p data-fit className="text-muted-foreground">
        {children}
      </p>
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
  fit,
  className,
}: {
  label: string;
  value: ReactNode;
  unit?: string | undefined;
  tone?: 'warning' | 'destructive' | undefined;
  /** It may go when the widget hasn't room for it (fit.ts): 1, or 2 to go before the 1s. */
  fit?: 1 | 2;
  className?: string;
}): ReactElement {
  return (
    <div data-fit={fit} className={cn('flex min-w-0 flex-col', className)}>
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
