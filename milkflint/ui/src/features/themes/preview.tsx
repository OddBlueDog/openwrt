// A theme drawn small, in its own colours: the menu, a page heading and a
// panel with text, a chart, the accent and the state colours. Any element
// carrying data-theme and data-darkmode gets that theme's tokens
// (src/theme/css.ts), so these are the real classes in another theme's
// colours, and a custom theme's draft shows the same way.
import type { ReactElement, ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

function Scope({
  themeId,
  dark,
  label,
  className,
  children,
}: {
  themeId: string;
  dark: boolean;
  label: string;
  className?: string;
  children: ReactNode;
}): ReactElement {
  return (
    <div
      data-theme={themeId}
      data-darkmode={dark ? 'true' : 'false'}
      role="img"
      aria-label={label}
      className={cn('flex overflow-hidden bg-background font-sans text-foreground', className)}
    >
      {children}
    </div>
  );
}

const line = 'block h-1.5 rounded-full';

/** A thumbnail: the shapes of a page, no words. */
export function ThemeThumbnail({
  themeId,
  dark,
  label,
  className,
}: {
  themeId: string;
  dark: boolean;
  label: string;
  className?: string;
}): ReactElement {
  return (
    <Scope themeId={themeId} dark={dark} label={label} className={cn('aspect-[8/5]', className)}>
      <div className="flex w-[30%] flex-col gap-1.5 border-r border-sidebar-border bg-sidebar p-2">
        <span className={cn(line, 'mb-1 w-3/4 bg-sidebar-foreground')} />
        <span className="flex h-3.5 items-center rounded-sm bg-sidebar-primary px-1">
          <span className={cn(line, 'w-2/3 bg-sidebar-primary-foreground')} />
        </span>
        <span className={cn(line, 'w-2/3 bg-sidebar-muted-foreground')} />
        <span className={cn(line, 'w-1/2 bg-sidebar-muted-foreground')} />
        <span className={cn(line, 'w-3/5 bg-sidebar-muted-foreground')} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2 p-2.5">
        <span className={cn(line, 'h-2 w-1/2 bg-foreground')} />
        <div className="flex flex-1 flex-col gap-1.5 rounded-md border bg-card p-2 shadow-xs">
          <span className={cn(line, 'w-2/3 bg-card-foreground')} />
          <span className={cn(line, 'w-1/2 bg-muted-foreground')} />
          <svg viewBox="0 0 60 16" preserveAspectRatio="none" className="h-4 w-full" aria-hidden="true">
            <polyline points="0,12 10,9 20,11 30,5 40,7 50,3 60,6" fill="none" stroke="var(--chart-1)" strokeWidth="1.5" />
            <polyline points="0,14 10,13 20,8 30,10 40,11 50,9 60,12" fill="none" stroke="var(--chart-2)" strokeWidth="1.5" />
          </svg>
          <span className="mt-auto flex items-center gap-1">
            <span className="h-2.5 w-7 rounded-sm bg-primary" />
            <span className="ml-auto size-1.5 rounded-full bg-success" />
            <span className="size-1.5 rounded-full bg-warning" />
            <span className="size-1.5 rounded-full bg-destructive" />
          </span>
        </div>
      </div>
    </Scope>
  );
}

/** The editor's preview: real words and controls in the draft's colours, so contrast can be judged by eye too. */
export function ThemeSample({ themeId, dark, label }: { themeId: string; dark: boolean; label: string }): ReactElement {
  return (
    <Scope themeId={themeId} dark={dark} label={label} className="rounded-lg border text-sm">
      {/* inert: a picture of controls, not ones to use */}
      <div inert className="flex w-full">
        <div className="flex w-[34%] flex-col gap-0.5 border-r border-sidebar-border bg-sidebar p-2 text-sidebar-foreground">
          <span className="px-2 py-1 font-semibold">MilkFlint</span>
          <span className="rounded-md bg-sidebar-primary px-2 py-1 font-medium text-sidebar-primary-foreground">Home</span>
          <span className="rounded-md bg-sidebar-accent px-2 py-1 text-sidebar-accent-foreground">Wi-Fi</span>
          <span className="px-2 py-1">Devices</span>
          <span className="px-2 py-1 text-xs text-sidebar-muted-foreground">System</span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-3 p-3">
          <div>
            <p className="font-semibold">Responsiveness</p>
            <p className="text-xs text-muted-foreground">Ping to 1.1.1.1</p>
          </div>
          <div className="flex flex-col gap-2.5 rounded-lg border bg-card p-3 text-card-foreground shadow-xs">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-2xl font-semibold tabular">
                9.4<span className="ml-0.5 text-sm font-medium text-muted-foreground">ms</span>
              </span>
              <Badge variant="success">Steady</Badge>
            </div>
            {/* the six chart colours, a line each in a band of its own so each can be told apart */}
            <svg viewBox="0 0 120 42" preserveAspectRatio="none" className="h-10 w-full" aria-hidden="true">
              <line x1="0" y1="41" x2="120" y2="41" stroke="var(--chart-grid)" strokeWidth="1" />
              {[1, 2, 3, 4, 5, 6].map((n) => {
                const y = n * 6;
                return (
                  <polyline
                    key={n}
                    points={`0,${String(y)} 24,${String(y - 2)} 48,${String(y + 1)} 72,${String(y - 3)} 96,${String(y)} 120,${String(y - 2)}`}
                    fill="none"
                    stroke={`var(--chart-${String(n)})`}
                    strokeWidth="2"
                    vectorEffect="non-scaling-stroke"
                  />
                );
              })}
            </svg>
            <div className="flex h-2 overflow-hidden rounded-full">
              {['bg-ramp-1', 'bg-ramp-2', 'bg-ramp-3', 'bg-ramp-4', 'bg-ramp-5'].map((c) => (
                <span key={c} className={cn('flex-1', c)} />
              ))}
            </div>
            <Input defaultValue="milkflint" className="h-8" />
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm">Save</Button>
              <Button size="sm" variant="outline">
                Discard
              </Button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Badge variant="warning">Warm</Badge>
              <Badge variant="destructive">Down</Badge>
              <Badge variant="info">Note</Badge>
              <Badge>Accent</Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Secondary text, and a <span className="font-medium text-primary underline">link</span>.
            </p>
          </div>
        </div>
      </div>
    </Scope>
  );
}
