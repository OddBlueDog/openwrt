// banIP and AdGuard Home on Home: what each is doing, and what it blocked.
// Each reads its own status, only while it's on Home, every 30 s (the same
// call as the notes above the grid).
import { dashboardQueries } from './queries';
import { useLive } from '@/lib/query/use-live';
import type { ReactElement } from 'react';
import { Sparkline } from '@/components/charts/sparkline';
import { formatNumber } from '@/lib/format';
import { pageLink } from '@/lib/router';
import type { AdGuardStatus } from '../adguardhome/api';
import { InsightsBody } from '../adguardhome/insights';
import { useInsights } from '../adguardhome/queries';
import { blockedShare, describeState as adguardState } from '../adguardhome/model';
import { describeState as banipState } from '../banip/model';
import type { Tone } from './model';
import { OffNote, StateBadge, Widget, WidgetLink } from './widget';

// one call for every AdGuard Home widget on Home (banIP's is shared with Home's warning: banip/api.ts)

/** The features' quiet tone is a state that's off here. */
const tone = (t: Tone | 'muted'): Tone | 'off' => (t === 'muted' ? 'off' : t);

/** A big figure with its label above and a line below. */
function Headline({ label, value, note }: { label: string; value: string; note?: string | undefined }): ReactElement {
  return (
    <div className="flex flex-col px-5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-3xl font-semibold tracking-tight tabular">{value}</span>
      {note !== undefined && (
        // one narrow column: a size down, so it keeps to a line
        <span data-fit className="text-sm text-muted-foreground tabular narrow:text-xs">
          {note}
        </span>
      )}
    </div>
  );
}

export function BanipCard(): ReactElement {
  // a firmware without it answers "not found"
  const { data, error } = useLive(dashboardQueries.banip());
  const link = <WidgetLink to={pageLink('banip')}>banIP</WidgetLink>;
  if (data === undefined) {
    return (
      <Widget aside={error === undefined ? undefined : link}>
        <OffNote action={null}>{error === undefined ? 'Reading banIP’s state…' : 'banIP didn’t answer.'}</OffNote>
      </Widget>
    );
  }
  const words = banipState(data);
  if (!data.installed || data.enabled !== true || data.state === 'off' || data.state === 'ap') {
    return (
      <Widget aside={<StateBadge tone={tone(words.tone)}>{words.label}</StateBadge>}>
        <OffNote action={data.state === 'ap' ? null : <WidgetLink to={pageLink('banip')}>Turn on banIP</WidgetLink>}>
          {data.state === 'ap'
            ? 'In access point mode the main router faces the internet.'
            : 'Blocks addresses on lists of known attackers, coming in and going out.'}
        </OffNote>
      </Widget>
    );
  }
  const drops = data.drops;
  const series = drops === undefined ? [] : drops.source === 'log' ? drops.logged : drops.counted;
  const end = drops?.end ?? undefined;
  return (
    <Widget
      aside={
        <>
          <StateBadge tone={tone(words.tone)}>{words.label}</StateBadge>
          {link}
        </>
      }
    >
      <Headline
        label="Addresses on its lists"
        value={data.elements === null || data.elements === undefined ? '—' : formatNumber(data.elements)}
        note={drops === undefined ? undefined : `${formatNumber(drops.hour)} blocked in the last hour`}
      />
      {series.length > 1 && drops !== undefined && (
        // what it blocked, step by step: takes the rest of the widget's height
        <Sparkline
          values={series}
          max={Math.max(1, ...series) * 1.2}
          slots={series.length}
          color="var(--chart-1)"
          label="Blocked"
          format={(n) => `${formatNumber(Math.round(n))} blocked`}
          timeOf={end === undefined ? undefined : (slot) => end - (series.length - 1 - slot) * drops.step}
          className="-mb-5 h-auto min-h-10 flex-1 overflow-hidden rounded-b-[calc(var(--mf-radius-xl)-1px)]"
        />
      )}
    </Widget>
  );
}

/** AdGuard Home's state for its widgets, and the widget itself while it's being read, failed or is off. */
function useAdGuard(): { data: AdGuardStatus; aside: ReactElement } | { off: ReactElement } {
  const { data, error } = useLive(dashboardQueries.adguard());
  const link = <WidgetLink to={pageLink('adguardhome')}>AdGuard Home</WidgetLink>;
  if (data === undefined) {
    return {
      off: (
        <Widget aside={error === undefined ? undefined : link}>
          <OffNote action={null}>{error === undefined ? 'Reading AdGuard Home’s state…' : 'AdGuard Home didn’t answer.'}</OffNote>
        </Widget>
      ),
    };
  }
  const words = adguardState(data);
  const badge = <StateBadge tone={tone(words.tone)}>{words.label}</StateBadge>;
  if (!data.installed || data.enabled !== true || data.mode === 'ap') {
    return {
      off: (
        <Widget aside={badge}>
          <OffNote
            action={data.mode === 'ap' ? null : <WidgetLink to={pageLink('adguardhome')}>Turn on AdGuard Home</WidgetLink>}
          >
            {data.mode === 'ap'
              ? 'In access point mode the main router answers your devices’ lookups.'
              : 'Blocks ads and trackers for every device, by their lookups.'}
          </OffNote>
        </Widget>
      ),
    };
  }
  return {
    data,
    aside: (
      <>
        {badge}
        {link}
      </>
    ),
  };
}

export function AdGuardCard(): ReactElement {
  const state = useAdGuard();
  if ('off' in state) return state.off;
  const { data, aside } = state;
  const stats = data.stats;
  const share = blockedShare(stats);
  return (
    <Widget aside={aside}>
      <Headline
        label="Lookups blocked"
        value={share ?? '—'}
        note={
          stats === null || stats === undefined
            ? 'No lookups counted yet'
            : `${formatNumber(stats.blocked)} of ${formatNumber(stats.queries)} in ${String(stats.hours)}\u00a0h`
        }
      />
      {stats?.avg_ms !== null && stats?.avg_ms !== undefined && (
        <p data-fit className="mt-auto px-5 text-sm text-muted-foreground tabular">
          {/* one line in one column */}
          {`Average answer ${formatNumber(stats.avg_ms, stats.avg_ms < 10 ? 1 : 0)}\u00a0ms`}
        </p>
      )}
    </Widget>
  );
}

/** What AdGuard Home is seeing, as on its page: read only while it's on. */
export function AdGuardInsightsCard(): ReactElement {
  const state = useAdGuard();
  if ('off' in state) return state.off;
  return <InsightsWidget aside={state.aside} />;
}

function InsightsWidget({ aside }: { aside: ReactElement }): ReactElement {
  const insights = useInsights();
  return (
    <Widget aside={aside} status={insights.span === undefined ? undefined : `Last ${insights.span}`}>
      <div className="flex flex-col gap-4 px-5">
        <InsightsBody insights={insights} widget />
      </div>
    </Widget>
  );
}
