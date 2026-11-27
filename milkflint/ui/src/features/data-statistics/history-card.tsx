// The Last 24 hours card (opt-in): each device's download and upload over the
// last 1, 4, 8 and 24 hours and a chart of the day, from what the router
// samples every 5 minutes. Off, it only says what the history keeps; the
// switch is on the Counting card. With a MAC it is one device's: its four
// windows and its own chart.
import type { ReactElement } from 'react';
import { Arrowed } from '@/components/dir';
import { Freshness } from '@/components/freshness';
import { CardHeading } from '@/components/card-heading';
import { niceCeil } from '@/components/charts/scale';
import { DataTable } from '@/components/data-table';
import { LoadError } from '@/components/page-states';
import { Card, CardContent } from '@/components/ui/card';
import { Answer, AnswerCell } from '@/components/page-kit';
import { TimeChart } from '@/components/charts/time-chart';
import { useLive } from '@/lib/query/use-live';
import { formatBitrate } from '@/lib/format';
import { chartSeries, sinceText, STEP, volume, windowColumns, windowRows, type History } from './history';
import { dataUsageQueries } from './queries';

/** What the off card says besides what the history keeps: that it is off, and where the switch is. */
export const HISTORY_OFF_NOW =
  'Off. Turn on Keep a 24-hour history per device under Counting to see each device’s last 1, 4, 8 and 24 hours.';

/** An empty history that only just started. */
const FIRST_FIGURES = 'Nothing yet. The first figures come about 5 minutes after the history is turned on.';

export const HISTORY_OFF =
  'Kept for a day: each hour’s figures are deleted 24 hours after that hour ends. Turning this off deletes them all at once.';

const DOWN = 'var(--chart-2)';
const UP = 'var(--chart-1)';
const QUIET: [number, number] = [0, 0];

export function HistoryCard({
  on,
  mac,
  names,
  hide,
}: {
  /** milkflint.datastats.history, as saved */
  on: boolean;
  /** One device's history; none: every device's */
  mac?: string | undefined;
  names: ReadonlyMap<string, string>;
  /** The router's own MACs */
  hide: ReadonlySet<string>;
}): ReactElement {
  if (!on) {
    return (
      <Card>
        <CardHeading title="Last 24 hours" description={HISTORY_OFF} />
        <p className="px-5 pb-5 text-sm">{HISTORY_OFF_NOW}</p>
      </Card>
    );
  }
  return <HistoryBody mac={mac} names={names} hide={hide} />;
}

function HistoryBody({
  mac,
  names,
  hide,
}: {
  mac: string | undefined;
  names: ReadonlyMap<string, string>;
  hide: ReadonlySet<string>;
}): ReactElement {
  // the router only has something new every 5 minutes, so there's no polling faster than that
  const poll = useLive(dataUsageQueries.history(mac));
  // the chart and "since" are drawn at the time the router answered, so a re-render doesn't move them
  const h = poll.at === undefined ? undefined : poll.data;
  const now = Math.floor((poll.at ?? 0) / 1000);
  const since = h === undefined ? '' : sinceText(h.since, now);
  return (
    <Card className="gap-0 pb-0">
      <CardHeading
        title="Last 24 hours"
        description={
          mac === undefined
            ? 'What each device downloaded and uploaded, busiest first.'
            : 'What this device downloaded and uploaded.'
        }
        status={
          <>
            {since !== '' && <span className="mr-3">{since}</span>}
            <Freshness at={poll.at} next={poll.next} />
          </>
        }
      />
      {h === undefined ? (
        poll.error === undefined ? (
          <p className="px-5 pb-5 text-sm text-muted-foreground">Loading…</p>
        ) : (
          <LoadError error={poll.error} retry={poll.refresh} />
        )
      ) : !h.on ? (
        <p className="px-5 pb-5 text-sm text-muted-foreground">
          The router isn’t keeping a history right now. It starts a moment after the switch is saved, and it is paused, with
          nothing kept, while Data usage is off.
        </p>
      ) : (
        <>
          <CardContent className="pb-4">
            <HistoryChart h={h} now={now} />
          </CardContent>
          {mac === undefined ? (
            <DataTable
              columns={windowColumns}
              rows={windowRows(h, names, hide)}
              rowKey={(r) => r.mac}
              empty={h.since === null ? FIRST_FIGURES : 'Nothing has moved since the history began.'}
              label="Data used in the last 24 hours"
            />
          ) : (
            <DeviceWindows h={h} mac={mac} />
          )}
        </>
      )}
    </Card>
  );
}

function DeviceWindows({ h, mac }: { h: History; mac: string }): ReactElement {
  const key = Object.keys(h.windows).find((k) => k.toLowerCase() === mac.toLowerCase());
  const w = key === undefined ? undefined : h.windows[key];
  const cell = (title: string, v: [number, number] | undefined): ReactElement => (
    <AnswerCell
      title={title}
      value={
        <span className="text-base font-semibold tabular">
          <Arrowed text={volume(v ?? QUIET)} />
        </span>
      }
    />
  );
  return (
    <div className="border-t">
      <Answer columns={4} label="This device in the last 24 hours">
        {cell('1 hour', w?.h1)}
        {cell('4 hours', w?.h4)}
        {cell('8 hours', w?.h8)}
        {cell('24 hours', w?.h24)}
      </Answer>
      {w === undefined && (
        <p className="px-5 pb-4 text-sm text-muted-foreground">
          {h.since === null ? FIRST_FIGURES : 'Nothing moved in the last 24 hours'}
        </p>
      )}
    </div>
  );
}

/** Download and upload as an average speed over each 5 minutes, across the last day. */
function HistoryChart({ h, now }: { h: History; now: number }): ReactElement {
  const s = chartSeries(h, now);
  const peak = Math.max(0, ...s.down.map((p) => p[1] ?? 0), ...s.up.map((p) => p[1] ?? 0));
  const quiet = h.series.length === 0;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded-full" style={{ background: DOWN }} aria-hidden="true" />
          Download
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded-full" style={{ background: UP }} aria-hidden="true" />
          Upload
        </span>
        <span>Average speed in each 5 minutes</span>
      </div>
      <TimeChart
        lines={[
          { label: 'Download', color: DOWN, points: s.down },
          { label: 'Upload', color: UP, points: s.up },
        ]}
        from={s.from}
        to={s.to}
        max={niceCeil(Math.max(peak * 1.1, 1000))}
        step={STEP}
        format={formatBitrate}
        label="Download and upload over the last 24 hours, as the average speed in each 5 minutes"
        xLabels={[
          { t: s.from, label: '24 h ago' },
          { t: s.from + 28_800, label: '16 h ago' },
          { t: s.from + 57_600, label: '8 h ago' },
          { t: s.to, label: 'Now' },
        ]}
        className="h-36"
        empty={quiet ? 'Nothing has moved yet' : undefined}
      />
    </div>
  );
}
