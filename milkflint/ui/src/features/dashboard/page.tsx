// Home: the router's live state as widgets on a grid of four columns (fewer
// on a narrower screen). Which widgets show, in what order and at what size
// is the layout (layout.ts): the theme's, until the user arranges their own
// with the pencil at the top right, which is kept on the router for every
// device and used in every theme. The widgets are in widgets.tsx.
import {
  ActivityIcon,
  ClockIcon,
  LayoutGridIcon,
  LoaderCircleIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  RotateCcwIcon,
} from 'lucide-react';
import { type ReactElement, useEffect, useMemo, useRef, useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useLoad } from '@/hooks/use-load';
import { firmwareName } from '@/lib/api/system';
import { getConfig } from '@/lib/api/uci';
import { href } from '@/lib/router';
import { useRouterMode } from '@/lib/router-mode';
import { useOnRequest } from '@/lib/presentation';
import { useTheme } from '@/lib/theme';
import { cn, errorMessage } from '@/lib/utils';
import { AdGuardHomeNote } from '../adguardhome/dashboard-note';
import { BanipNote } from '../banip/dashboard-note';
import { type Live, useLive } from '../network-quality/live';
import { zoneChosen } from '../time/zone';
import { AddWidgetSheet } from './add-widget-sheet';
import { type Editing, HomeGrid } from './home-grid';
import {
  addWidget,
  GRID_CLASS,
  GRID_CONTAINER_CLASS,
  type Layout,
  moveWidget,
  removeWidget,
  resizeWidget,
  sameLayout,
  sizeClass,
} from './layout';
import { addLoadPairs, lastPairedAt } from './load-store';
import { pairPings } from './model';
import { type Dashboard, POLL_MS, useDashboard } from './use-dashboard';
import { useHomeLayout } from './use-home-layout';
import { definition, type HomeData, parseHome, type WidgetId } from './widgets';

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

function Loading({ layout }: { layout: Layout }): ReactElement {
  return (
    <div className={GRID_CONTAINER_CLASS} aria-busy="true" aria-label="Loading the router’s status">
      <div className={GRID_CLASS}>
        {layout.slice(0, 8).map((w) => (
          <Skeleton key={w.key} className={cn('min-h-44 rounded-xl', sizeClass(w.size))} />
        ))}
      </div>
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

/** An edit in progress: the layout as it stands, and whether it's the user's own or the theme's. */
interface Draft {
  layout: Layout<WidgetId>;
  own: boolean;
}

export function DashboardPage(): ReactElement {
  const { data, error, loading, refresh } = useDashboard();
  const live = useLive(QUALITY_POLL_MS);
  const { theme } = useTheme();
  const onRequest = useOnRequest();
  const ap = useRouterMode() === 'ap';
  const home = useHomeLayout();
  usePairLoad(live.data, data);

  const themeLayout = useMemo(() => parseHome(theme.dashboard.widgets), [theme]);
  const [draft, setDraft] = useState<Draft>();
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState<string>();
  const [said, setSaid] = useState('');
  /** the widget just added (its key), to focus once the catalogue has closed */
  const added = useRef<string | undefined>(undefined);

  const layout = draft?.layout ?? home.saved ?? themeLayout;
  const props: HomeData | undefined = data === undefined ? undefined : { d: data, live, ap };
  const editingOn = draft !== undefined;

  const editing = useMemo((): Editing | undefined => {
    if (!editingOn) return undefined;
    const change = (edit: (l: Layout<WidgetId>) => Layout<WidgetId>): void => {
      setDraft((d) => (d === undefined ? d : { layout: edit(d.layout), own: true }));
    };
    return {
      move: (from, to) => {
        change((l) => moveWidget(l, from, to));
      },
      resize: (key, size) => {
        change((l) => resizeWidget(l, key, size));
      },
      remove: (key) => {
        change((l) => removeWidget(l, key));
      },
      announce: setSaid,
    };
  }, [editingOn]);

  const start = (): void => {
    setFailed(undefined);
    setSaid('');
    setDraft({ layout, own: home.saved !== undefined });
  };
  const cancel = (): void => {
    setDraft(undefined);
    setFailed(undefined);
  };
  const done = async (): Promise<void> => {
    if (draft === undefined) return;
    const before = home.saved ?? themeLayout;
    if (draft.own === (home.saved !== undefined) && sameLayout(draft.layout, before)) {
      setDraft(undefined);
      return;
    }
    setSaving(true);
    setFailed(undefined);
    try {
      // the user's own, or back to following the theme's
      await home.save(draft.own ? draft.layout : undefined);
      setDraft(undefined);
    } catch (e) {
      setFailed(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };
  const add = (id: WidgetId): void => {
    if (draft === undefined) return;
    const next = addWidget(draft.layout, id, definition(id).sizes[0]);
    added.current = next === draft.layout ? undefined : next[next.length - 1]?.key;
    setDraft({ layout: next, own: true });
    setSaid(`${definition(id).title} added, at the end.`);
    setAdding(false);
  };
  const openCatalogue = (): void => {
    if (!home.editable) return;
    if (draft === undefined) start();
    setAdding(true);
  };
  const isThemes = draft !== undefined && !draft.own && sameLayout(draft.layout, themeLayout);

  const actions =
    draft !== undefined ? (
      <>
        <Button variant="outline" data-home-add onClick={openCatalogue}>
          <PlusIcon /> Add widget
        </Button>
        <Button
          variant="outline"
          aria-label="Reset to the theme’s layout"
          title="Back to the theme’s layout"
          disabled={isThemes || saving}
          onClick={() => {
            setDraft({ layout: themeLayout, own: false });
            setSaid('Back to the theme’s layout.');
          }}
        >
          <RotateCcwIcon /> Reset
        </Button>
        <Button variant="outline" disabled={saving} onClick={cancel}>
          Cancel
        </Button>
        <Button disabled={saving} onClick={() => void done()}>
          {saving && <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" />} Done
        </Button>
      </>
    ) : (
      data !== undefined && (
        <>
          {/* a calm theme says "Live" only when it isn't: while reconnecting */}
          {(!onRequest || error !== undefined) && <Live stale={error !== undefined} />}
          {/* not while what the router keeps isn't known: a save would replace it */}
          {home.ready && home.editable && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="size-8" aria-label="Edit Home" onClick={start}>
                  <PencilIcon />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Edit Home</TooltipContent>
            </Tooltip>
          )}
        </>
      )
    );

  return (
    <>
      <PageHeader
        title="Home"
        description={data === undefined ? 'Everything at a glance, live.' : undefined}
        status={
          draft !== undefined
            ? 'Editing. Done saves Home for every device.'
            : data === undefined
              ? undefined
              : [data.board.hostname, data.board.model, firmwareName(data.board.release)].filter(Boolean).join(' · ')
        }
        actions={actions}
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
      ) : props === undefined || !home.ready ? (
        <Loading layout={layout} />
      ) : (
        <div className="flex flex-col gap-4">
          {failed !== undefined && (
            <Alert variant="destructive">
              <ActivityIcon />
              <AlertTitle>Home wasn’t saved</AlertTitle>
              <AlertDescription>{failed} Your changes are still here: try Done again, or Cancel.</AlertDescription>
            </Alert>
          )}
          <div className="flex flex-col gap-2 empty:hidden">
            <SetupNote />
            <AdGuardHomeNote />
            <BanipNote />
          </div>
          {layout.length === 0 ? (
            <Card className="items-center gap-2 px-5 py-10 text-center">
              <LayoutGridIcon className="size-6 text-muted-foreground" aria-hidden="true" />
              <h2 className="font-semibold">Home has no widgets</h2>
              <p className="max-w-prose text-sm text-muted-foreground">Add the ones you want to see when you open the router.</p>
              <Button className="mt-2" onClick={openCatalogue}>
                <PlusIcon /> Add widget
              </Button>
            </Card>
          ) : (
            <HomeGrid layout={layout} data={props} editing={editing} />
          )}
          {editing !== undefined && (
            <>
              <p aria-live="polite" className="sr-only">
                {said}
              </p>
              <AddWidgetSheet
                open={adding}
                onOpenChange={setAdding}
                layout={layout}
                data={props}
                onAdd={add}
                onCloseAutoFocus={(e) => {
                  const key = added.current;
                  if (key === undefined) return;
                  added.current = undefined;
                  e.preventDefault();
                  const cell = document.querySelector(`[data-key="${key}"]`);
                  cell?.querySelector<HTMLElement>('[data-control="handle"]')?.focus({ preventScroll: true });
                  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
                  cell?.scrollIntoView({ block: 'center', behavior: still ? 'auto' : 'smooth' });
                }}
              />
            </>
          )}
        </div>
      )}
    </>
  );
}
