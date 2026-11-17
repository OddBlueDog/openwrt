// The way from the internet to the devices, one step at a time, each with
// what the router measures there and a link to its page. Shared steps first,
// then the last hop (each device uses one of them).
import { ChevronRightIcon } from 'lucide-react';
import type { ReactElement } from 'react';
import type { Poll } from '@/hooks/use-poll';
import { href } from '@/lib/router';
import { cn } from '@/lib/utils';
import { type Live, WINDOW_SECONDS } from '../network-quality/live';
import { summarize } from '../network-quality/score';
import { lineBusyNow, type PathStep, pathSteps, type StepState } from './model';
import type { Dashboard } from './use-dashboard';
import { Dot, StateBadge, Widget } from './widget';
import { useWidgetInfo } from './widget-info';

const tone = { ok: 'success', busy: 'warning', down: 'destructive', off: 'off' } as const satisfies Record<StepState, string>;

/** A step: its name and state, what's there (in full only), and what the router measures. */
function Step({ s, last, full }: { s: PathStep; last: boolean; full: boolean }): ReactElement {
  return (
    <li className="relative flex min-w-0">
      <a
        href={href(s.route)}
        className={cn(
          'group flex min-w-0 flex-1 flex-col gap-2 rounded-lg border p-3 transition-colors duration-fast hover:border-rule',
          s.state === 'busy' && 'border-warning/40 bg-warning-subtle',
          s.state === 'down' && 'border-destructive/40 bg-destructive-subtle',
          s.state === 'off' && 'border-dashed bg-muted/40',
          (s.state === 'ok' || s.state === 'off') && 'hover:bg-accent/40',
        )}
      >
        <span className="flex flex-col gap-0.5">
          <span className="truncate text-sm font-semibold" title={s.name}>
            {s.name}
          </span>
          <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Dot tone={tone[s.state]} />
            <span className="truncate">{s.status}</span>
          </span>
        </span>
        {full && (
          // only with four columns' width: below it, the groups are stacked and need the height
          <span className="hidden flex-col gap-0.5 text-xs text-muted-foreground @4xl:flex">
            {s.lines.map((l) => (
              <span key={l} className="text-pretty">
                {l}
              </span>
            ))}
          </span>
        )}
        {(s.delays.length > 0 || s.figure !== undefined) &&
          (full ? (
            // each reading's label above its value: the labels run long for a narrow step; the last steps'
            // go first where the widget is short of room (its groups stacked, below four columns' width)
            <span data-fit className="mt-auto flex flex-col gap-1.5 border-t pt-2">
              {s.delays.map((x) => (
                <span key={x.label} className="flex flex-col">
                  <span className="text-xs text-muted-foreground">{x.label}</span>
                  <span className="text-base font-semibold whitespace-nowrap tabular">{x.value}</span>
                </span>
              ))}
              {s.figure !== undefined && (
                <span className="flex flex-col">
                  <span className="text-xs text-muted-foreground">{s.figure.label}</span>
                  <span className="text-base font-semibold whitespace-nowrap tabular">{s.figure.value}</span>
                </span>
              )}
            </span>
          ) : (
            // short: the readings' values on a line, their labels on hover; they go when the widget is short of room
            <span data-fit className="mt-auto truncate text-sm font-semibold tabular">
              {[...s.delays, ...(s.figure === undefined ? [] : [s.figure])].map((x, i) => (
                <span key={x.label} title={x.label}>
                  {i > 0 && <span className="font-normal text-muted-foreground"> · </span>}
                  {x.value}
                </span>
              ))}
            </span>
          ))}
      </a>
      {/* from one shared step to the next, on a wide card */}
      {!last && (
        <ChevronRightIcon
          aria-hidden="true"
          className="absolute top-1/2 -right-3 hidden size-3.5 translate-x-1/2 -translate-y-1/2 text-muted-foreground @4xl:block"
        />
      )}
    </li>
  );
}

function Group({
  title,
  steps,
  chain,
  full,
}: {
  title: string;
  steps: readonly PathStep[];
  chain: boolean;
  full: boolean;
}): ReactElement {
  return (
    <div
      className={cn('flex min-w-0 flex-col gap-2', full && '@4xl:row-span-2 @4xl:grid @4xl:grid-rows-subgrid')}
      // short and side by side: each group as wide as its share of the steps
      style={full ? undefined : { flex: `${String(steps.length)} 1 0` }}
    >
      <h3 className="flex items-center gap-3 text-xs font-medium text-muted-foreground">
        {title}
        <span aria-hidden="true" className="h-px flex-1 bg-border" />
      </h3>
      {/* short: a group's steps on one line, however narrow */}
      <ol
        className={cn(
          'grid gap-3',
          full
            ? 'grid-cols-2 @lg:auto-cols-fr @lg:grid-flow-col @lg:grid-cols-none @4xl:grid-rows-1 @4xl:gap-6'
            : 'auto-cols-fr grid-flow-col @4xl:gap-6',
        )}
      >
        {steps.map((s, i) => (
          <Step key={s.key} s={s} last={!chain || i === steps.length - 1} full={full} />
        ))}
      </ol>
    </div>
  );
}

export function PathCard({ d, ap, live }: { d: Dashboard; ap: boolean; live: Poll<Live> }): ReactElement {
  // the whole width and two rows: each step in full; smaller, each its name, state and readings
  const { size } = useWidgetInfo();
  const full = size.w === 4 && size.h === 2;
  const latest = d.history[d.history.length - 1];
  const gateway = d.lan?.route?.find((r) => r.target === '0.0.0.0' && r.mask === 0)?.nexthop;
  // Network Quality's last five minutes: the internet ping and the gateway's (the first hop)
  const nq =
    live.data?.status.enabled === true
      ? summarize(
          live.data.samples.filter((s) => s.t > (live.data?.status.now ?? 0) - WINDOW_SECONDS),
          live.data.status.gateway_answers,
        )
      : undefined;
  const { shared, last } = pathSteps({
    ap,
    online: ap ? d.lan?.up === true && gateway !== undefined : d.wan?.up === true,
    noWan: d.wan === undefined,
    wanDown: latest?.wanDown,
    wanUp: latest?.wanUp,
    lineBusy: lineBusyNow(d.history, d.cake.find((c) => c.download)?.bandwidth, d.cake.find((c) => !c.download)?.bandwidth),
    probe:
      nq === undefined
        ? undefined
        : { internet: nq.probes.internet.typical, gateway: nq.probes.gateway.typical, gatewaySilent: nq.gatewaySilent },
    cake: d.cake,
    cpu: d.cpu,
    cores: d.cores,
    radios: d.radios,
    wired: d.wired,
    lanUp: d.lan?.up === true,
    gateway,
  });
  const flagged = [...shared, ...last].filter((s) => s.state === 'busy' || s.state === 'down');

  return (
    <Widget
      description="From the internet to your devices, and what the router measures at each step"
      aside={
        flagged.length === 0 ? (
          <StateBadge tone="success">Nothing busy</StateBadge>
        ) : (
          <StateBadge tone={flagged.some((s) => s.state === 'down') ? 'destructive' : 'warning'}>
            {flagged.map((s) => `${s.name} ${s.status.toLowerCase()}`).join(', ')}
          </StateBadge>
        )
      }
    >
      {/* at full width the two groups share their rows, so every step ends on one line */}
      <div
        className={cn(
          'px-5',
          full
            ? 'grid gap-4 @4xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] @4xl:grid-rows-[auto_1fr] @4xl:gap-x-6 @4xl:gap-y-2'
            : 'flex flex-col gap-4 @xl:flex-row @xl:gap-6',
        )}
      >
        <Group title="Shared by all traffic" steps={shared} chain full={full} />
        <Group title="The last hop: each device uses one" steps={last} chain={false} full={full} />
      </div>
      <p data-fit className="px-5 text-xs text-muted-foreground">
        Delays are what the router measures: Network Quality’s pings (typical over the last 5 minutes) and Smart Queue’s own
        queues. It doesn’t measure the delay inside the router, on the Wi-Fi or on the cables.
      </p>
    </Widget>
  );
}
