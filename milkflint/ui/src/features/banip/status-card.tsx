// The top of the banIP page, the answer: its state in words (Off, Updating
// lists with banIP's own progress, Protecting, Error with what to do), how
// many connections it blocked, the numbers behind that, the switch and
// "Update lists now", the lookup box, and the day of drops along the bottom
// edge. While it's off, what turning it on does and costs.
import { LoaderCircleIcon, RefreshCwIcon, RotateCcwIcon, TriangleAlertIcon } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import { Note } from '@/components/note';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { BanipStatus } from './api';
import { LookupBox } from './lookup';
import { daySeries, describeState, RESULTS, type Tone, turnOnText } from './model';
import { DropRibbon } from './ribbon';

const DOT: Record<Tone, string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  info: 'bg-info',
  muted: 'bg-muted-foreground/50',
  destructive: 'bg-destructive',
};

function when(t: number | null | undefined, now: number): string {
  if (t === null || t === undefined) return '–';
  const d = new Date(t * 1000);
  const today = new Date(now * 1000).toDateString() === d.toDateString();
  const tomorrow = new Date((now + 86400) * 1000).toDateString() === d.toDateString();
  const hm = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return today
    ? `today ${hm}`
    : tomorrow
      ? `tomorrow ${hm}`
      : d.toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
}

function lastUpdate(s: BanipStatus): string {
  const l = s.last;
  if (l?.finished !== null && l?.finished !== undefined) {
    const took = l.started !== null && l.started !== undefined ? Math.max(0, l.finished - l.started) : null;
    const t =
      took === null ? '' : took < 1 ? ' (<1 s)' : took < 60 ? ` (${String(took)} s)` : ` (${String(Math.round(took / 60))} min)`;
    return `${when(l.finished, s.now ?? l.finished)}${t}`;
  }
  return s.last_run?.at ?? '–';
}

function Stat({ label, children, sub }: { label: string; children: ReactNode; sub?: string }): ReactElement {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate text-sm font-medium tabular">{children}</dd>
      {sub !== undefined && <dd className="truncate text-xs text-muted-foreground tabular">{sub}</dd>}
    </div>
  );
}

export function StatusCard({
  s,
  busy,
  conntrack,
  nothingChosen,
  onToggle,
  onUpdate,
  onRestart,
  onChanged,
}: {
  s: BanipStatus;
  busy: string | undefined;
  conntrack: boolean;
  /** No list chosen yet: turning it on starts the Recommended ones. */
  nothingChosen: boolean;
  onToggle: (on: boolean) => void;
  onUpdate: () => void;
  onRestart: () => void;
  onChanged: () => void;
}): ReactElement {
  const words = describeState(s);
  const state = s.state ?? 'off';
  const on = s.enabled === true;
  const ap = state === 'ap';
  const run = s.run;
  const drops = s.drops;
  const series = daySeries(drops === undefined ? [] : drops.source === 'counters' ? drops.counted : drops.logged);
  const failed = Object.entries(s.last?.results ?? {});
  const lists = (s.feeds ?? []).filter((f) => f !== 'country' && f !== 'asn').length;
  const countries = s.countries?.length ?? 0;
  const pct =
    run?.expected !== null && run?.expected !== undefined && run.expected > 0
      ? Math.round(((run.done ?? 0) / run.expected) * 100)
      : null;
  const summary = `Drops over the last 24 hours: ${formatNumber(drops?.day ?? 0)}, ${formatNumber(drops?.hour ?? 0)} in the last hour.`;
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="flex flex-col gap-5 p-5 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="min-w-0 flex-1 basis-80">
            <div className="flex items-center gap-2.5">
              <span
                className={cn(
                  'size-2.5 shrink-0 rounded-full',
                  DOT[words.tone],
                  state === 'updating' && 'animate-pulse motion-reduce:animate-none',
                )}
                aria-hidden="true"
              />
              <h2 className="text-lg font-semibold tracking-tight">{words.label}</h2>
            </div>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{words.text}</p>
            {state === 'error' && (
              <Button size="sm" variant="outline" className="mt-3" disabled={busy !== undefined} onClick={onRestart}>
                {busy === 'restart' ? <LoaderCircleIcon className="animate-spin" /> : <RotateCcwIcon />} Start it again
              </Button>
            )}
          </div>
          <div className="flex items-center gap-4">
            {on && !ap && (
              <Button size="sm" variant="outline" disabled={busy !== undefined || state === 'updating'} onClick={onUpdate}>
                {busy === 'update' ? <LoaderCircleIcon className="animate-spin" /> : <RefreshCwIcon />} Update lists now
              </Button>
            )}
            {!ap && (
              <span className="flex items-center gap-2">
                <Switch
                  aria-label={on ? 'Turn banIP off' : 'Turn banIP on'}
                  checked={on}
                  disabled={busy !== undefined}
                  onCheckedChange={(v) => {
                    onToggle(v);
                  }}
                />
                <span className="w-6 text-sm font-medium" aria-hidden="true">
                  {on ? 'On' : 'Off'}
                </span>
              </span>
            )}
          </div>
        </div>

        {/* always laid out, so the card doesn't jump as a run starts and ends */}
        <div className={cn('flex flex-col gap-1.5', state !== 'updating' && 'hidden')} aria-live="polite">
          <Progress value={pct ?? 8} className={cn(pct === null && 'opacity-60')} aria-label="Updating the lists" />
          <p className="text-xs text-muted-foreground tabular">
            {run?.stage === 'lists' && pct !== null ? `${String(run.done ?? 0)} of ${String(run.expected)} lists` : 'Preparing'}
            {s.last_run?.duration !== null && s.last_run?.duration !== undefined
              ? `. The last update took ${String(s.last_run.duration)} s.`
              : ''}
          </p>
        </div>

        {on && !ap && (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 border-t pt-4 sm:grid-cols-3 lg:grid-cols-5">
            <Stat label="Blocked, last 24 hours" sub={`${formatNumber(drops?.hour ?? 0)} in the last hour`}>
              {formatNumber(drops?.day ?? 0)}
            </Stat>
            <Stat label="Addresses on the lists">
              {s.elements !== null && s.elements !== undefined ? formatNumber(s.elements) : '–'}
            </Stat>
            <Stat label="Lists">
              {String(lists)}
              {countries > 0 ? `, ${String(countries)} ${countries === 1 ? 'country' : 'countries'}` : ''}
            </Stat>
            <Stat label="Last update">{lastUpdate(s)}</Stat>
            <Stat label="Next update">
              {s.schedule?.next !== null && s.schedule?.next !== undefined ? when(s.schedule.next, s.now ?? 0) : 'not scheduled'}
            </Stat>
          </dl>
        )}
        {!on && !ap && (
          <div className="border-t pt-4">
            <p className="max-w-3xl text-sm text-muted-foreground">{turnOnText(nothingChosen)}</p>
          </div>
        )}

        {failed.length > 0 && state !== 'updating' && (
          <Note tone="warning" icon={<TriangleAlertIcon />}>
            In the last update,{' '}
            {failed
              .slice(0, 4)
              .map(([set, what]) => `${set} ${RESULTS[what] ?? what}`)
              .join('; ')}
            {failed.length > 4 ? `; and ${String(failed.length - 4)} more` : ''}. The other lists are working.
          </Note>
        )}

        {!ap && <LookupBox conntrack={conntrack} onChanged={onChanged} />}
      </div>
      {/* the day of drops while it's on; off, only the line saying where they'll show */}
      {on && !ap && <DropRibbon values={series} end={drops?.end} step={drops?.step ?? 300} summary={summary} />}
      <div
        className={cn(
          'flex flex-wrap items-baseline justify-between gap-x-4 bg-muted/40 px-5 pb-3 text-xs text-muted-foreground sm:px-6',
          !(on && !ap) && 'border-t pt-3',
        )}
      >
        <span>
          {on && !ap
            ? `Blocked connections per five minutes, over the last day${drops?.source === 'log' ? ': the ones logged (turn on counting for all of them, in Advanced)' : ''}.`
            : 'Blocked connections, per five minutes, show here while banIP is on.'}
        </span>
        {/* as apk, LuCI's Software page and banIP's own status give it: the -rN is banIP's update number */}
        {s.version !== null && s.version !== undefined && <span>banIP {s.version}</span>}
      </div>
    </Card>
  );
}
