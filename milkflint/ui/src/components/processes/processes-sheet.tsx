// What's running on the router, as top shows it: each process's user, name,
// share of the processor and memory, in a side sheet opened from Home's CPU
// card and About's Processor card. The router is read only while the sheet
// is open: once, again a second later (CPU use needs two readings), then
// every 3 s; never while it's paused or the tab is hidden. A row opens to
// its command line, parent, state, threads and age.
import { pageLink } from '@/lib/router';
import { Link } from '@tanstack/react-router';
import { ChevronRightIcon, ListIcon, PauseIcon, PlayIcon, SearchIcon, TriangleAlertIcon } from 'lucide-react';
import { type ReactElement, type ReactNode, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { type Column, DataTable } from '@/components/data-table';
import { Note } from '@/components/note';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { getProcesses, type ProcessList } from '@/lib/api/processes';
import { formatBytes, formatDuration, formatNumber, formatPercent } from '@/lib/format';
import { UbusError, UbusStatus } from '@/lib/ubus';
import { cn, errorMessage } from '@/lib/utils';
import {
  CLOCK_TICKS,
  formatShare,
  type ProcessRow,
  type ProcessView,
  shownRows,
  type Snapshot,
  snapshot,
  stateLabel,
} from './model';

const EVERY_MS = 3000;
/** the second reading, so CPU use shows soon after opening */
const FIRST_MS = 1000;

/** A firmware whose rpcd plugin has no `processes` yet (the UI pushed onto an older image). */
const unsupported = (err: unknown): boolean =>
  err instanceof UbusError && (err.code === UbusStatus.methodNotFound || err.code === UbusStatus.permissionDenied);

/**
 * Reads the list while mounted and not paused. Each (re)start takes a fresh
 * base reading and shows figures from the one after it, so a resume never
 * shows the average over the pause.
 */
function useProcesses(paused: boolean): { snap: Snapshot | undefined; error: unknown; retry: () => void } {
  const [snap, setSnap] = useState<Snapshot>();
  const [error, setError] = useState<unknown>();
  const [tick, setTick] = useState(0);
  const base = useRef<ProcessList>(undefined);

  useEffect(() => {
    if (paused) return;
    let cancelled = false;
    let timer: number | undefined;
    let fresh = true;
    let busy = false;

    const run = async (): Promise<void> => {
      timer = undefined;
      busy = true;
      try {
        const next = await getProcesses();
        if (cancelled) return;
        const prev = fresh ? undefined : base.current;
        base.current = next;
        // a restart keeps the figures on show until there are new ones
        setSnap((shown) => (prev === undefined && shown !== undefined ? shown : snapshot(prev, next)));
        setError(undefined);
        if (!document.hidden) timer = window.setTimeout(() => void run(), fresh ? FIRST_MS : EVERY_MS);
        fresh = false;
      } catch (err) {
        if (cancelled) return;
        setError(err);
        if (!unsupported(err) && !document.hidden) timer = window.setTimeout(() => void run(), EVERY_MS);
      } finally {
        busy = false;
      }
    };
    const onVisibility = (): void => {
      if (document.hidden) {
        window.clearTimeout(timer);
        timer = undefined;
      } else if (timer === undefined && !busy) {
        fresh = true;
        void run();
      }
    };

    void run();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [paused, tick]);

  const retry = useCallback(() => {
    setTick((n) => n + 1);
  }, []);
  return { snap, error, retry };
}

const views: readonly { value: ProcessView; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'programs', label: 'Programs' },
  { value: 'kernel', label: 'Kernel threads' },
];

/** One of the figures above the list: a label over its value. */
function Figure({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-base font-semibold tabular">{children}</dd>
    </div>
  );
}

function Detail({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }): ReactElement {
  return (
    <div className={cn('flex min-w-0 flex-col gap-0.5', wide && 'col-span-2 sm:col-span-3')}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm">{children}</dd>
    </div>
  );
}

/** A row opened: what top's other columns and `ps -f` would say. */
function Details({ r, snap, id }: { r: ProcessRow; snap: Snapshot; id: string }): ReactElement {
  const { p } = r;
  const parent = p.ppid === 0 ? undefined : snap.names.get(p.ppid);
  const age = Math.max(0, snap.uptime - p.start / CLOCK_TICKS);
  return (
    <dl id={id} data-details className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
      <Detail label="Command" wide>
        {p.kernel ? (
          <span className="text-muted-foreground">None: a kernel thread runs inside the kernel itself.</span>
        ) : (
          <span className="font-mono text-xs break-all whitespace-pre-wrap">{p.cmd === '' ? p.name : p.cmd}</span>
        )}
      </Detail>
      <Detail label="User">{p.user}</Detail>
      <Detail label="Process ID">
        <span className="tabular">{p.pid}</span>
      </Detail>
      <Detail label="Started by">
        {p.ppid === 0 ? (
          <span className="text-muted-foreground">The kernel, at boot</span>
        ) : (
          <span className="tabular">
            {parent ?? 'A process that has ended'} <span className="text-muted-foreground">({p.ppid})</span>
          </span>
        )}
      </Detail>
      <Detail label="State">{stateLabel(p.state)}</Detail>
      <Detail label="Threads">
        <span className="tabular">{formatNumber(p.threads)}</span>
      </Detail>
      <Detail label="Started">
        <span className="tabular">{age < 1 ? 'Just now' : `${formatDuration(age)} ago`}</span>
      </Detail>
      <Detail label="CPU time so far">
        <span className="tabular">{formatDuration(p.ticks / CLOCK_TICKS)}</span>
      </Detail>
    </dl>
  );
}

/** The list's columns: figures sort busiest first, words A to Z; a name opens its row. */
function processColumns(opened: ReadonlySet<string>, ids: string, onToggle: (key: string) => void): Column<ProcessRow>[] {
  return [
    {
      label: 'Name',
      // in line with the names, past the arrows
      header: <span className="pl-6">Name</span>,
      cell: (r) => {
        const open = opened.has(r.key);
        const { p } = r;
        return (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={open ? `${ids}-${r.key}` : undefined}
            onClick={() => {
              onToggle(r.key);
            }}
            className="flex w-full min-w-0 cursor-pointer items-center gap-2 py-2 text-left"
          >
            <ChevronRightIcon
              aria-hidden
              className={cn('size-4 shrink-0 text-muted-foreground transition-transform duration-fast', open && 'rotate-90')}
            />
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-medium">{r.name}</span>
              {/* wide: the command line; a phone, which has no User or PID column: those */}
              <span className="hidden truncate text-xs text-muted-foreground sm:block">
                {p.kernel ? 'Kernel thread' : <span className="font-mono">{p.cmd === '' ? p.name : p.cmd}</span>}
              </span>
              <span className="truncate text-xs text-muted-foreground tabular sm:hidden">
                {p.kernel ? 'Kernel thread' : p.user} · {p.pid}
              </span>
            </span>
          </button>
        );
      },
      sort: (r) => r.name,
      className: 'w-full max-w-0 py-0',
    },
    {
      label: 'User',
      cell: (r) => r.p.user,
      sort: (r) => r.p.user,
      className: 'hidden whitespace-nowrap text-muted-foreground sm:table-cell',
    },
    {
      label: 'PID',
      cell: (r) => r.p.pid,
      sort: (r) => r.p.pid,
      className: 'hidden text-right whitespace-nowrap text-muted-foreground tabular sm:table-cell',
    },
    {
      label: 'CPU',
      // not yet measured: last, with a dash
      cell: (r) =>
        r.cpu === undefined ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <span className={r.cpu === 0 ? 'text-muted-foreground' : 'font-medium'}>{formatShare(r.cpu)}</span>
        ),
      sort: (r) => r.cpu,
      sortDescFirst: true,
      className: 'text-right whitespace-nowrap tabular',
    },
    {
      label: 'Memory',
      cell: (r) => (r.p.kernel ? <span className="text-muted-foreground">—</span> : formatBytes(r.p.rss)),
      sort: (r) => r.p.rss,
      sortDescFirst: true,
      className: 'text-right whitespace-nowrap tabular',
    },
  ];
}

function Body(): ReactElement {
  const [paused, setPaused] = useState(false);
  const [view, setView] = useState<ProcessView>('all');
  const [query, setQuery] = useState('');
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const { snap, error, retry } = useProcesses(paused);
  const ids = useId();

  const rows = useMemo(() => (snap === undefined ? [] : shownRows(snap.rows, view, query)), [snap, view, query]);
  const columns = useMemo(
    () =>
      processColumns(opened, ids, (key) => {
        setOpened((was) => {
          const next = new Set(was);
          if (!next.delete(key)) next.add(key);
          return next;
        });
      }),
    [opened, ids],
  );
  const kernel = snap?.rows.filter((r) => r.p.kernel).length ?? 0;

  return (
    <>
      <div className="flex flex-col gap-1 border-b px-5 py-4 pr-12">
        <SheetTitle>Processes</SheetTitle>
        <SheetDescription>What’s running on the router, read every 3 s while this is open.</SheetDescription>
      </div>

      <div className="flex flex-col gap-3 border-b px-5 py-3">
        {/* the same overall figures as Home's, then top's count */}
        <dl className="flex flex-wrap gap-x-6 gap-y-2">
          <Figure label="CPU in use">{snap?.cpu === undefined ? '—' : formatPercent(snap.cpu)}</Figure>
          <Figure label="Memory in use">{snap === undefined ? '—' : formatPercent(snap.memory)}</Figure>
          <Figure label="Processes">
            {snap === undefined ? (
              '—'
            ) : (
              <>
                {formatNumber(snap.rows.length)}
                <span className="ml-1.5 hidden text-sm font-normal text-muted-foreground sm:inline">
                  {formatNumber(snap.rows.length - kernel)} programs · {formatNumber(kernel)} kernel threads
                </span>
              </>
            )}
          </Figure>
        </dl>
        {/* wide: one row; a phone: the kind and Pause, then the search under them */}
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <Segmented label="Show" value={view} options={views} onChange={setView} />
          <div className="flex items-center gap-3 sm:order-last">
            <span aria-live="polite" className="text-sm text-muted-foreground">
              {paused ? 'Paused' : ''}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={snap === undefined}
              onClick={() => {
                setPaused((p) => !p);
              }}
            >
              {paused ? <PlayIcon aria-hidden /> : <PauseIcon aria-hidden />}
              {paused ? 'Resume' : 'Pause'}
            </Button>
          </div>
          <div className="relative w-full sm:w-auto sm:min-w-40 sm:flex-1">
            <SearchIcon
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              type="search"
              value={query}
              placeholder="Find a process"
              aria-label="Find a process by name, command, user or process ID"
              className="pl-9"
              onChange={(e) => {
                setQuery(e.target.value);
              }}
            />
          </div>
        </div>
        {error !== undefined && snap !== undefined && (
          <Note tone="warning" icon={<TriangleAlertIcon />}>
            Couldn’t read the list again ({errorMessage(error)}); showing the last one and trying again.
          </Note>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {snap === undefined ? (
          error === undefined ? (
            <div role="status" className="flex flex-col gap-3 px-5 py-4">
              <span className="sr-only">Reading the process list…</span>
              {Array.from({ length: 8 }, (_, i) => (
                <Skeleton key={i} className="h-9" />
              ))}
            </div>
          ) : unsupported(error) ? (
            <Note tone="info" icon={<TriangleAlertIcon />} className="px-5 py-4">
              This router’s firmware can’t list its processes yet: it comes with a newer MilkFlint.{' '}
              <Link {...pageLink('upgrade')} className="font-medium link">
                Upgrade
              </Link>
            </Note>
          ) : (
            <Note tone="destructive" icon={<TriangleAlertIcon />} title="Couldn’t read the process list" className="px-5 py-4">
              {errorMessage(error)}
              <Button variant="outline" size="sm" onClick={retry} className="mt-2 flex">
                Try again
              </Button>
            </Note>
          )
        ) : (
          <DataTable
            label="Processes"
            columns={columns}
            rows={rows}
            rowKey={(r) => r.key}
            empty="No process matches."
            initialSort={{ id: 'CPU', desc: true }}
            framed={false}
            cards={false}
            stickyHeader
            rowProps={(r) => (opened.has(r.key) ? { className: 'bg-muted/50 hover:bg-muted/50' } : {})}
            detail={(r) => opened.has(r.key) && <Details r={r} snap={snap} id={`${ids}-${r.key}`} />}
            // an opened row's details share its shade
            className="[&_tr:has(>td>[data-details])]:bg-muted/50"
          />
        )}
      </div>

      {snap !== undefined && (
        <p className="border-t px-5 py-3 text-xs text-muted-foreground">
          {snap.cores > 1
            ? `CPU is a share of all ${formatNumber(snap.cores)} cores, so one core fully busy shows as ${formatShare(1 / snap.cores)}. `
            : ''}
          Memory is what a process holds in RAM; a kernel thread has none of its own.
        </p>
      )}
    </>
  );
}

/** The process list in a side sheet; mounted (and reading the router) only while open. */
export function ProcessesSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }): ReactElement {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-3xl">{open && <Body />}</SheetContent>
    </Sheet>
  );
}

/**
 * Opens the process list: a link-like "Processes ›" in a Home widget's
 * heading, or an outline button in a page card's.
 */
export function ProcessesButton({ look }: { look: 'widget' | 'card' }): ReactElement {
  const [open, setOpen] = useState(false);
  const show = (): void => {
    setOpen(true);
  };
  return (
    <>
      {look === 'widget' ? (
        <button
          type="button"
          onClick={show}
          className="inline-flex min-h-6 cursor-pointer items-center gap-0.5 text-sm font-medium link"
        >
          Processes
          <ChevronRightIcon className="size-4" aria-hidden="true" />
        </button>
      ) : (
        <Button type="button" variant="outline" size="sm" onClick={show}>
          <ListIcon aria-hidden />
          Processes
        </Button>
      )}
      <ProcessesSheet open={open} onOpenChange={setOpen} />
    </>
  );
}
