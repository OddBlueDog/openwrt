// Home: the router's live state as widgets on a 12-column grid. Which
// widgets show, in what order and how wide comes from the theme's layout
// (theme.dashboard.widgets), so a theme, and later the user, can rearrange
// it; the widgets themselves are in widgets.tsx.
import { ActivityIcon, ClockIcon, RefreshCwIcon } from 'lucide-react';
import { type ReactElement, useEffect, useRef } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useLoad } from '@/hooks/use-load';
import { firmwareName } from '@/lib/api/system';
import { getConfig } from '@/lib/api/uci';
import { href } from '@/lib/router';
import { useRouterMode } from '@/lib/router-mode';
import { useOnRequest } from '@/lib/presentation';
import { useTheme } from '@/lib/theme';
import { cn, errorMessage } from '@/lib/utils';
import type { DashboardWidget } from '@/theme/contract';
import { AdGuardHomeNote } from '../adguardhome/dashboard-note';
import { BanipNote } from '../banip/dashboard-note';
import { type Live, useLive } from '../network-quality/live';
import { zoneChosen } from '../time/zone';
import { addLoadPairs, lastPairedAt } from './load-store';
import { pairPings } from './model';
import { type Dashboard, POLL_MS, useDashboard } from './use-dashboard';
import { isWidgetId, rowClass, spanClass, type WidgetId, withoutHidden } from './widget-ids';
import { widgets, type WidgetProps } from './widgets';

/** How often Home asks Network Quality for its newest pings. */
const QUALITY_POLL_MS = 5000;

function Live({ stale }: { stale: boolean }): ReactElement {
  return stale ? (
    <Badge variant="warning">
      <RefreshCwIcon className="animate-spin motion-reduce:animate-none" /> Reconnecting
    </Badge>
  ) : (
    <Badge variant="outline" className="gap-2 text-muted-foreground">
      <span className="relative flex size-2" aria-hidden="true">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60 motion-reduce:hidden" />
        <span className="relative inline-flex size-2 rounded-full bg-success" />
      </span>
      Live · every {POLL_MS / 1000} s
    </Badge>
  );
}

const loadSystem = async (): Promise<boolean> => zoneChosen((await getConfig('system')).find((s) => s['.type'] === 'system'));

/** Shown until a time zone is picked, on the Name & time page or in LuCI. */
function SetupNote(): ReactElement | null {
  const { data: chosen } = useLoad(loadSystem);
  if (chosen !== false) return null;
  return (
    <Alert variant="info" className="py-2.5">
      <ClockIcon />
      <AlertDescription className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <span>
          <span className="font-medium">Name your router and choose its time zone.</span> Schedules and logs follow its clock,
          which is on UTC until you choose.
        </span>
        <a href={href('time')} className="inline-flex min-h-6 items-center font-medium link">
          Name &amp; time
        </a>
      </AlertDescription>
    </Alert>
  );
}

const reported = new Set<string>();

/** The theme's widgets that Home knows; an unknown id is left out (and said once, in development). */
function known(layout: readonly DashboardWidget[]): (DashboardWidget & { id: WidgetId })[] {
  return layout.filter((w): w is DashboardWidget & { id: WidgetId } => {
    if (isWidgetId(w.id)) return true;
    if (import.meta.env.DEV && !reported.has(w.id)) {
      reported.add(w.id);
      console.error(`Home: the theme places a widget "${w.id}" that doesn't exist (see features/dashboard/widget-ids.ts)`);
    }
    return false;
  });
}

function Loading({ layout }: { layout: readonly DashboardWidget[] }): ReactElement {
  return (
    <div className="grid grid-cols-12 gap-4" aria-busy="true" aria-label="Loading the router’s status">
      {layout.slice(0, 8).map((w) => (
        <Skeleton key={w.id} className={cn('h-44 rounded-xl', spanClass(w.span))} />
      ))}
    </div>
  );
}

/**
 * Pairs Network Quality's pings with the WAN rate Home polls, while Home is
 * open, for at rest against under load (model.ts, pairPings). Pings no rate
 * covers yet are tried again after the next poll.
 */
function usePairLoad(live: Live | undefined, d: Dashboard | undefined): void {
  // the browser's clock less the router's, taken when each answer arrives
  const offset = useRef<{ live: Live; seconds: number } | undefined>(undefined);
  useEffect(() => {
    if (live === undefined || d === undefined || !live.status.enabled) return;
    if (offset.current?.live !== live) offset.current = { live, seconds: Date.now() / 1000 - live.status.now };
    const since = lastPairedAt();
    const down = d.cake.find((c) => c.download);
    const up = d.cake.find((c) => !c.download);
    addLoadPairs(
      pairPings(
        live.samples.filter((s) => s.t > since),
        d.history,
        offset.current.seconds,
        { down: down?.bandwidth, up: up?.bandwidth },
        POLL_MS / 1000,
      ),
      live.status.now,
    );
  }, [live, d]);
}

export function DashboardPage(): ReactElement {
  const { data, error, loading, refresh } = useDashboard();
  const live = useLive(QUALITY_POLL_MS);
  const { theme } = useTheme();
  const onRequest = useOnRequest();
  const ap = useRouterMode() === 'ap';
  usePairLoad(live.data, data);
  const props: WidgetProps | undefined = data === undefined ? undefined : { d: data, live, ap };
  const placed = known(theme.dashboard.widgets);
  // widgets with nothing to show on this router leave, their columns to a neighbour
  const layout = withoutHidden(
    placed,
    new Set(props === undefined ? [] : placed.flatMap((w) => (widgets[w.id].hidden?.(props) === true ? [w.id] : []))),
  );

  return (
    <>
      <PageHeader
        title="Home"
        description={data === undefined ? 'Everything at a glance, live.' : undefined}
        status={
          data === undefined
            ? undefined
            : [data.board.hostname, data.board.model, firmwareName(data.board.release)].filter(Boolean).join(' · ')
        }
        // a calm theme says "Live" only when it isn't: while reconnecting
        actions={data !== undefined && (!onRequest || error !== undefined) && <Live stale={error !== undefined} />}
      />

      {data === undefined && error !== undefined && !loading ? (
        <Alert variant="destructive">
          <ActivityIcon />
          <AlertTitle>Couldn&apos;t load the router&apos;s status</AlertTitle>
          <AlertDescription>
            {errorMessage(error)}
            <Button variant="outline" size="sm" onClick={refresh} className="mt-2">
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      ) : data === undefined ? (
        <Loading layout={layout} />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2 empty:hidden">
            <SetupNote />
            <AdGuardHomeNote />
            <BanipNote />
          </div>
          {/* dense: shorter widgets stack beside a tall one (a layout's rows) */}
          <div className="grid grid-flow-row-dense grid-cols-12 gap-4">
            {props !== undefined &&
              layout.map((w) => (
                // a widget that fits its content keeps its own height; the others fill their row
                <div
                  key={w.id}
                  className={cn('grid min-w-0', widgets[w.id].fit === true && 'items-start', spanClass(w.span), rowClass(w.rows))}
                >
                  <WidgetSlot id={w.id} props={props} />
                </div>
              ))}
          </div>
        </div>
      )}
    </>
  );
}

function WidgetSlot({ id, props }: { id: WidgetId; props: WidgetProps }): ReactElement {
  const Render = widgets[id].render;
  return <Render {...props} />;
}
