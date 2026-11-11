// Airtime fairness on each band now: who is using the air, what the policy
// makes of each device's link and the share it gives it, and the last minute.
// Its switch is in each band's settings.
import { HourglassIcon, MoonIcon, ScaleIcon, SignalHighIcon, SignalIcon, SignalLowIcon, SignalMediumIcon, SignalZeroIcon } from 'lucide-react';
import { type ReactElement, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { usePoll } from '@/hooks/use-poll';
import { type AirtimeDevice, type AirtimeRadio, describeRate, getAirtime } from '@/lib/api/wireless';
import { formatBitrate, formatDuration, formatPercent } from '@/lib/format';
import { cn } from '@/lib/utils';
import { airtimeFill } from './airtime-colors';
import {
  AIRTIME_CLASS_LABELS,
  AIRTIME_CLASSES,
  AIRTIME_FULL_WEIGHT,
  AIRTIME_STRIP_MARKS,
  type AirtimeClass,
  type AirtimeSegment,
  airtimeAgo,
  airtimeByClass,
  airtimeChainsWords,
  airtimeChannelsLabel,
  airtimeClassHint,
  airtimeColumnAgo,
  airtimeColumns,
  airtimeDoing,
  AIRTIME_AUTO_LABELS,
  airtimeStrengthOf,
  airtimeTrimWords,
  airtimeHeldWords,
  airtimeState,
  AIRTIME_STATE_LABELS,
  airtimeKey,
  airtimeLabel,
  airtimeSecondParts,
  airtimeSecondTotal,
  airtimeSegments,
  airtimeShare,
  airtimeShareWords,
  airtimeSignalLevel,
  airtimeSignalWords,
  airtimeSorted,
  airtimeWeightPart,
} from './airtime';

const POLL_MS = 2_000;
/** The strip's columns: a minute, a second each */
const SECONDS = 60;
/** Devices always listed; past these, only the ones the policy gives less than a full share */
const LISTED = 6;

// A colour a class, the same in the bar, the list and the strip (airtime-colors.ts)
const fill = airtimeFill;

/** A name on a segment: the lighter of the theme's two text colours on the amber, the page's background on the rest */
const onFill: Record<AirtimeClass, string> = {
  full: 'text-background',
  slow: 'text-background dark:text-foreground',
  weak: 'text-background',
  lost: 'text-background',
};

/** What other networks and noise took: the same grey in the bar, its legend and the last minute */
const otherFill = 'bg-muted-foreground/35';

/** The unfilled part of a class's meter: its colour, faint */
const track: Record<AirtimeClass, string> = {
  full: 'bg-chart-2/20',
  slow: 'bg-warning/20',
  weak: 'bg-destructive/20',
  lost: 'bg-foreground/15',
};

const heading = 'text-xs font-medium tracking-wide text-muted-foreground uppercase';

function bandLabel(band: string): string {
  return band === '2g' ? '2.4 GHz' : band === '5g' ? '5 GHz' : band === '6g' ? '6 GHz' : band;
}

/** A share of the air: "<1%" for some but under half a percent, so it doesn't read as none */
function percent(share: number): string {
  return share > 0 && share < 0.005 ? '<1%' : formatPercent(share);
}

function mbit(rate: number): string {
  return formatBitrate(rate * 1_000_000);
}

type Segment = AirtimeSegment<AirtimeDevice>;

function segmentTitle(s: Segment): string {
  if (s.kind !== 'device') return `${s.label}: ${percent(s.share)} of the last second`;
  return `${s.label}: ${percent(s.share)} of the last second (${airtimeLabel(s.device.class, s.device.paced).toLowerCase()})`;
}

/** The whole bar in words, for a screen reader: devices that used the air, then the rest */
function barLabel(band: string, segments: readonly Segment[]): string {
  const parts = segments
    .filter((s) => s.kind !== 'device' || s.share >= 0.005)
    .map((s) =>
      s.kind === 'device'
        ? `${s.label} ${percent(s.share)}, ${airtimeLabel(s.device.class, s.device.paced).toLowerCase()}`
        : `${s.label.toLowerCase()} ${percent(s.share)}`,
    );
  return `The air on ${band} in the last second: ${parts.join('; ')}.`;
}

/**
 * The last second's air as one bar: a segment per device in its class's
 * colour, then other networks and noise; what's left of the track is free.
 * Every device has its segment, used the air or not, so one grows from
 * nothing when it starts to. A segment wide enough has the device's name on it.
 */
function AirBar({
  band,
  segments,
  active,
  onActive,
}: {
  band: string;
  segments: readonly Segment[];
  active: string | undefined;
  onActive: (key: string | undefined) => void;
}): ReactElement {
  return (
    <div role="img" aria-label={barLabel(band, segments)} className="flex h-7 overflow-hidden rounded-md bg-muted">
      {segments.map((s) =>
        s.kind === 'free' ? null : (
          <div
            key={s.key}
            title={segmentTitle(s)}
            className={cn(
              '@container h-full min-w-0 transition-[width,opacity] duration-500 ease-out motion-reduce:transition-none',
              active !== undefined && active !== s.key && 'opacity-35',
            )}
            style={{ width: `${String(s.width * 100)}%` }}
            onPointerEnter={() => {
              if (s.kind === 'device') onActive(s.key);
            }}
            onPointerLeave={() => {
              onActive(undefined);
            }}
          >
            {/* the 2px to its right is the gap to the next segment */}
            <div className={cn('mr-0.5 flex h-full items-center rounded-[3px]', s.kind === 'device' ? fill[s.device.class] : otherFill)}>
              {s.kind === 'device' && (
                <span className={cn('hidden min-w-0 truncate px-1.5 text-[11px] leading-4 font-medium @min-[6rem]:block', onFill[s.device.class])}>
                  {s.label}
                </span>
              )}
            </div>
          </div>
        ),
      )}
    </div>
  );
}

/**
 * What the bar's colours are, each with its share now: every class while the
 * band has devices, then the rest of the air. Where the policy is on, a class
 * says on hover what it gets.
 */
function Legend({
  devices,
  segments,
  applied,
  pacing,
}: {
  devices: readonly AirtimeDevice[];
  segments: readonly Segment[];
  applied: boolean;
  pacing: boolean;
}): ReactElement {
  const byClass = airtimeByClass(devices);
  const rest = segments.filter((s) => s.kind !== 'device');
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {devices.length > 0 &&
        AIRTIME_CLASSES.map((cls) => (
          <li key={cls} className="flex items-center gap-1.5" title={applied ? airtimeClassHint(cls, pacing) : undefined}>
            <span className={cn('size-2.5 shrink-0 rounded-[3px]', fill[cls])} aria-hidden />
            {AIRTIME_CLASS_LABELS[cls]}
            <span className="tabular text-foreground">{percent(byClass[cls])}</span>
          </li>
        ))}
      {rest.map((s) => (
        <li key={s.key} className="flex items-center gap-1.5">
          <span className={cn('size-2.5 shrink-0 rounded-[3px]', s.kind === 'other' ? otherFill : 'border bg-muted')} aria-hidden />
          {s.label}
          <span className="tabular text-foreground">{percent(s.share)}</span>
        </li>
      ))}
    </ul>
  );
}

/** A device's class. Where the policy is off it's only what the policy would make of the link: dashed, no colour. */
function ClassBadge({ cls, paced, applied }: { cls: AirtimeClass; paced: boolean; applied: boolean }): ReactElement {
  const label = airtimeLabel(cls, paced);
  if (!applied) {
    return (
      <Badge variant="outline" className="border-dashed font-normal text-muted-foreground" title="What the policy would make of its link. It’s off on this band.">
        {label}
      </Badge>
    );
  }
  switch (cls) {
    case 'full':
      return (
        <Badge variant="secondary" title={airtimeClassHint(cls)}>
          {label}
        </Badge>
      );
    case 'slow':
      return (
        <Badge variant="warning" title={airtimeClassHint(cls)}>
          {label}
        </Badge>
      );
    case 'weak':
      return (
        <Badge variant="destructive" title={airtimeClassHint(cls)}>
          {label}
        </Badge>
      );
    case 'lost':
      return (
        <Badge variant="secondary" className="bg-foreground text-background" title={airtimeClassHint(cls)}>
          {label}
        </Badge>
      );
  }
}

/** A signal's strength at a glance: more bars for a stronger one */
const signalIcons = [SignalZeroIcon, SignalLowIcon, SignalMediumIcon, SignalHighIcon, SignalIcon] as const;

function DeviceRow({
  d,
  applied,
  possible,
  pacing,
  noise,
  competing,
  active,
  onActive,
}: {
  d: AirtimeDevice;
  /** the band's policy is on: the weight and the queue allowance are set */
  applied: boolean;
  /** switching the policy on would change something: the driver has weights to set */
  possible: boolean;
  /** the driver can hold a device back by time */
  pacing: boolean;
  /** the noise the radio measures on its channel, dBm */
  noise: number | null;
  /** with auto applied: how many devices that aren't held back wanted the air (0: none, which counts as one) */
  competing: number | null;
  active: boolean;
  onActive: (key: string | undefined) => void;
}): ReactElement {
  const words = airtimeShareWords(d.weight);
  // on, only what the router says it did; off, what the policy would do,
  // where it could do anything
  const applying =
    d.narrowed || d.pace > 0 ? airtimeDoing(d.class, true, { tries: d.tries, pace: d.pace, aim: d.aim, competing: competing ?? undefined }) : undefined;
  // with auto, how the driver's pacing differs from its share
  const trimmed = applied ? airtimeTrimWords(d.pace, d.aim) : undefined;
  const doing = applied ? applying : possible ? airtimeDoing(d.class, false, { wouldPace: d.paced && pacing }) : undefined;
  const held = applied && d.pace > 0 ? airtimeHeldWords(d.held) : undefined;
  // its link in detail: the signal the router hears it at, how the router
  // sends to it, the rate it sends at, how long it has been connected
  const signal = airtimeSignalWords(d.signal, noise);
  const SignalBars = d.signal === null ? undefined : signalIcons[airtimeSignalLevel(d.signal)];
  const link = [
    ...(describeRate(d.tx_phy ?? undefined)?.split(' · ') ?? []),
    d.rx_rate > 0 ? `it sends at ${mbit(d.rx_rate)}` : undefined,
    d.connected === null ? undefined : `connected ${formatDuration(d.connected)}`,
  ].filter((part) => part !== undefined);
  return (
    <li
      className={cn(
        '-mx-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-3 py-2.5 transition-colors @min-[36rem]:grid-cols-[minmax(0,1fr)_13rem_4rem]',
        active && 'bg-muted/60',
      )}
      onPointerEnter={() => {
        onActive(airtimeKey(d));
      }}
      onPointerLeave={() => {
        onActive(undefined);
      }}
    >
      <div className="flex min-w-0 gap-2">
        {/* level with the name's line, as tall as the badge beside it */}
        <span className={cn('mt-[7px] size-2 shrink-0 rounded-full', fill[d.class])} aria-hidden />
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            {d.name === null ? (
              <span className="min-w-0 truncate font-mono text-xs leading-[22px]">{d.mac}</span>
            ) : (
              <span className="min-w-0 truncate text-sm leading-[22px] font-medium" title={d.mac}>
                {d.name}
              </span>
            )}
            <ClassBadge cls={d.class} paced={d.paced} applied={applied} />
            {d.asleep > 0.5 && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground" title="In power save for most of the last second">
                <MoonIcon className="size-3" aria-hidden />
                asleep
              </span>
            )}
            {held !== undefined && d.held > 0.5 && (
              <span
                className="flex items-center gap-1 text-xs text-muted-foreground"
                title="Its traffic waited for most of the last second, so that devices with a good link could use the air"
              >
                <HourglassIcon className="size-3" aria-hidden />
                held back
              </span>
            )}
          </div>
          <p
            className="text-xs text-muted-foreground tabular"
            title={
              d.rate > 0
                ? `The router sends to it at ${mbit(d.rate)} and ${formatPercent(d.delivery)} of what it sends gets a frame through, which is worth ${mbit(d.useful)}.`
                : undefined
            }
          >
            {d.rate > 0 ? `${mbit(d.rate)} · ${mbit(d.useful)} useful` : 'Rate not known yet'}
          </p>
          {(signal !== undefined || link.length > 0) && (
            // each part stays whole and keeps its dot behind it, so a line that wraps never starts with one
            <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground tabular">
              {signal !== undefined && (
                <span className="flex items-center gap-1 whitespace-nowrap" title={airtimeChainsWords(d.chains)}>
                  {SignalBars !== undefined && <SignalBars className="size-3.5" aria-hidden />}
                  {signal}
                  {link.length > 0 && <span aria-hidden>·</span>}
                </span>
              )}
              {link.map((part, i) => (
                <span key={part} className="whitespace-nowrap">
                  {part}
                  {i < link.length - 1 && <span aria-hidden> ·</span>}
                </span>
              ))}
            </p>
          )}
          {doing !== undefined && (
            <p className={cn('text-xs', applied ? 'text-foreground' : 'text-muted-foreground')} title={trimmed}>
              {doing}
            </p>
          )}
          {held !== undefined && <p className="text-xs text-foreground tabular">{held}</p>}
        </div>
      </div>
      <div className="order-3 col-span-2 flex flex-col gap-1 @min-[36rem]:order-none @min-[36rem]:col-span-1">
        <div
          role="meter"
          aria-label={`Share of the air for ${d.name ?? d.mac}`}
          aria-valuemin={0}
          aria-valuemax={AIRTIME_FULL_WEIGHT}
          aria-valuenow={d.weight}
          aria-valuetext={words}
          title={`Airtime weight ${String(d.weight)} of ${String(AIRTIME_FULL_WEIGHT)}`}
          className={cn('h-1.5 overflow-hidden rounded-full', applied ? track[d.class] : 'bg-muted')}
        >
          <div
            className={cn('h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none', applied ? fill[d.class] : 'bg-muted-foreground/40')}
            style={{ width: `${String(airtimeWeightPart(d.weight) * 100)}%` }}
          />
        </div>
        <span className="text-xs text-muted-foreground first-letter:uppercase">{words}</span>
      </div>
      <div className="order-2 flex flex-col items-end @min-[36rem]:order-none">
        <span className="text-sm font-semibold tabular">{percent(airtimeShare(d))}</span>
        <span className="text-[11px] leading-tight text-muted-foreground">of the air</span>
      </div>
    </li>
  );
}

/** The strip's scale at one of its sides: all of the air at the top, down to a quarter */
function StripMarks({ side }: { side: 'left' | 'right' }): ReactElement {
  return (
    <div aria-hidden className={cn('relative w-8 shrink-0 text-[10px] leading-none text-muted-foreground tabular', side === 'left' ? 'text-right' : 'text-left')}>
      {AIRTIME_STRIP_MARKS.map((mark) => (
        // the top one hangs from the strip's edge, the others are centred on their line
        <span key={mark} className={cn('absolute inset-x-0', mark < 1 && '-translate-y-1/2')} style={{ top: `${String((1 - mark) * 100)}%` }}>
          {formatPercent(mark)}
        </span>
      ))}
    </div>
  );
}

/**
 * The last minute, a column a second: how much of the air the band's devices
 * took, split by class, with what other networks and noise took on top. Full
 * height is all of the air, with marks at each quarter on both sides; the
 * column under the pointer shows that second in full, like the bar above,
 * and how long ago it was by the router's clock (`now`). Each second is
 * placed by its own time, so one the router didn't measure is a gap.
 */
function LastMinute({ band, history, now }: { band: string; history: AirtimeRadio['history']; now: number }): ReactElement {
  const [pointed, setPointed] = useState<number>();
  const columns = airtimeColumns(history, SECONDS);
  const newest = columns.at(-1)?.t ?? 0;
  const peak = Math.max(0, ...columns.map((c) => (c.second === undefined ? 0 : airtimeSecondTotal(c.second))));
  const column = pointed === undefined ? undefined : columns[pointed];
  const second = column?.second;
  // a gap within the history: the router didn't measure that second
  const gap = column !== undefined && second === undefined && history.length > 0 && column.t > Math.round(history[0]?.t ?? Infinity);
  const parts = second === undefined ? [] : airtimeSecondParts(second);
  // How far along the strip the pointed column is, in percent. The breakdown
  // sits above it and is shifted left by as much of its own width, so it
  // stays within the strip at either end.
  const along = pointed === undefined ? 0 : ((pointed + 0.5) / SECONDS) * 100;
  return (
    <div className="flex flex-col gap-1.5">
      <h4 className={heading}>The last minute</h4>
      <div className="flex gap-1.5">
        <StripMarks side="left" />
        <div className="relative min-w-0 flex-1">
          <div
            role="img"
            aria-label={`The air on ${band} in each of the last ${String(SECONDS)} seconds, on a scale of all of it: this band’s devices by class, then other networks and noise. The most this band’s devices took in one second: ${percent(peak)}.`}
            className="relative flex h-28 gap-px overflow-hidden rounded-md bg-muted/60"
            onPointerLeave={() => {
              setPointed(undefined);
            }}
          >
            {AIRTIME_STRIP_MARKS.filter((mark) => mark < 1).map((mark) => (
              <div key={mark} aria-hidden className="pointer-events-none absolute inset-x-0 border-t border-foreground/10" style={{ bottom: `${String(mark * 100)}%` }} />
            ))}
            {columns.map(({ second: s }, i) => (
              <div
                key={i}
                className={cn('relative flex h-full min-w-0 flex-1 flex-col-reverse', pointed === i && (s !== undefined || gap) && 'bg-foreground/10')}
                onPointerEnter={() => {
                  setPointed(i);
                }}
              >
                {s !== undefined &&
                  AIRTIME_CLASSES.map((cls) =>
                    s[cls] > 0 ? <div key={cls} className={cn('shrink-0', fill[cls])} style={{ height: `${String(Math.min(1, s[cls]) * 100)}%` }} /> : null,
                  )}
                {/* on top of the band's own devices, as in the bar of the air right now */}
                {s !== undefined && s.other !== null && s.other > 0 && (
                  <div className={cn('shrink-0', otherFill)} style={{ height: `${String(Math.min(1, s.other) * 100)}%` }} />
                )}
              </div>
            ))}
          </div>
          {column !== undefined && (second !== undefined || gap) && (
            <div
              className="pointer-events-none absolute bottom-full z-10 mb-1.5 rounded-md border bg-popover px-2.5 py-1.5 text-xs whitespace-nowrap text-popover-foreground shadow-md"
              style={{ left: `${String(along)}%`, transform: `translateX(-${String(along)}%)` }}
            >
              <p className="font-medium">{airtimeAgo(airtimeColumnAgo(column.t, now, newest))}</p>
              {gap && <p className="text-muted-foreground">Not measured</p>}
              <ul className="mt-1 flex flex-col gap-0.5 empty:hidden">
                {parts.map((part) => (
                  <li key={part.key} className="flex items-center gap-1.5">
                    <span
                      className={cn('size-2 shrink-0 rounded-[2px]', part.key === 'other' ? otherFill : part.key === 'free' ? 'border bg-muted' : fill[part.key])}
                      aria-hidden
                    />
                    {part.label}
                    <span className="ml-auto pl-4 tabular" title={part.share === null ? 'The channel wasn’t measured that second: it’s only measured while this page is open.' : undefined}>
                      {part.share === null ? '–' : percent(part.share)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <StripMarks side="right" />
      </div>
      {/* in line with the strip: past each side's marks and the gap to them */}
      <div className="flex justify-between px-[2.375rem] text-[11px] text-muted-foreground">
        <span>A minute ago</span>
        <span>Now</span>
      </div>
    </div>
  );
}

function RadioPanel({ radio, now }: { radio: AirtimeRadio; now: number }): ReactElement {
  // the device under the pointer, in the bar or the list: picked out in both
  const [pointed, setActive] = useState<string>();
  const [all, setAll] = useState(false);
  const band = bandLabel(radio.band);
  const segments = airtimeSegments(radio.devices, radio.busy, radio.other);
  // one that has left since isn't picked out any more
  const active = segments.some((s) => s.key === pointed) ? pointed : undefined;
  const ours = radio.devices.reduce((n, d) => n + airtimeShare(d), 0);
  const free = segments.find((s) => s.kind === 'free')?.share ?? 0;
  const sorted = airtimeSorted(radio.devices);
  const short = sorted.filter((d, i) => i < LISTED || d.class !== 'full');
  const listed = all ? sorted : short;
  const channels = airtimeChannelsLabel(radio.channel, radio.channels, radio.width);
  const state = airtimeState(radio.on, radio.weights);
  // only then is anything set on the devices
  const applied = state === 'on';
  const strength = airtimeStrengthOf(radio.auto);

  return (
    <div className="@container flex flex-col gap-4 rounded-lg border bg-background/60 p-3">
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <h3 className="text-sm font-medium">{band}</h3>
            {channels !== undefined && <span className="text-xs text-muted-foreground">{channels}</span>}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {/* with the policy on and the driver able to pace: how the shares of the devices held back are set */}
            {applied && radio.pacing && strength !== undefined && <Badge variant="outline">{AIRTIME_AUTO_LABELS[strength]}</Badge>}
            <Badge variant={applied ? 'success' : 'outline'}>{AIRTIME_STATE_LABELS[state]}</Badge>
          </div>
        </div>
        {state === 'watching' && (
          <p className="text-xs text-muted-foreground">
            The policy is off on this band, so the router’s own airtime fairness applies: an equal share for every busy device, however slow its link. Each
            device’s class is what the policy would make of its link.
          </p>
        )}
        {state === 'unsupported' && (
          <p className="text-xs text-muted-foreground">
            The policy is on for this band, but this radio’s driver doesn’t share the air by weight, so there is nothing for it to set. Each device’s class is
            what the policy makes of its link.
          </p>
        )}
      </div>

      {radio.devices.length === 0 && <p className="text-sm text-muted-foreground">No devices connected on this band.</p>}

      {(radio.devices.length > 0 || radio.busy !== null) && (
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-2">
            <h4 className={heading}>The air right now</h4>
            <span className="text-xs text-muted-foreground tabular">
              {radio.busy === null ? `${percent(Math.min(1, ours))} used by this band’s devices` : `${percent(1 - free)} in use`}
            </span>
          </div>
          <AirBar band={band} segments={segments} active={active} onActive={setActive} />
          <Legend devices={radio.devices} segments={segments} applied={applied} pacing={radio.pacing} />
        </div>
      )}

      {radio.devices.length > 0 && (
        <div className="flex flex-col gap-1">
          <h4 className={heading}>Devices, most airtime first</h4>
          <ul className="flex flex-col divide-y">
            {listed.map((d) => (
              <DeviceRow
                key={airtimeKey(d)}
                d={d}
                applied={applied}
                possible={radio.weights}
                pacing={radio.pacing}
                noise={radio.noise}
                competing={radio.competing}
                active={active === airtimeKey(d)}
                onActive={setActive}
              />
            ))}
          </ul>
          {short.length < sorted.length && (
            <Button
              variant="link"
              size="sm"
              className="self-start px-0"
              onClick={() => {
                setAll((a) => !a);
              }}
            >
              {all ? 'Show fewer' : `Show all ${String(sorted.length)}`}
            </Button>
          )}
        </div>
      )}

      {radio.devices.length > 0 && radio.history.length > 0 && <LastMinute band={band} history={radio.history} now={now} />}
    </div>
  );
}

export function AirtimeCard({ className }: { className?: string }): ReactElement | null {
  const { data } = usePoll(getAirtime, POLL_MS);
  if (data === undefined || (data.running && data.radios.length === 0)) return null;
  const order = (band: string): number => ['2g', '5g', '6g'].indexOf(band);
  const radios = [...data.radios].sort((a, b) => order(a.band) - order(b.band));

  return (
    <Card className={className}>
      <CardHeader className="items-center">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <ScaleIcon className="size-4" />
        </div>
        <div className="flex flex-col gap-1">
          <CardTitle className="text-base">Airtime fairness</CardTitle>
          <CardDescription>
            Who is using the air on each band, second by second. With a band’s policy on (the switch is in its settings), a device with a poor link gets a
            smaller share while others want the air, and the slowest are held back for part of the time while a device with a good link has traffic waiting. A
            link is judged by its useful rate: the rate the router sends to the device at, times the share of its frames that get through.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="@container">
        {!data.running ? (
          <p className="text-sm text-muted-foreground">Nothing to show yet: the measuring has only just started, or the airtime service isn’t running.</p>
        ) : (
          <div className={cn('grid gap-4', radios.length > 1 && '@min-[80rem]:grid-cols-2')}>
            {radios.map((r) => (
              <RadioPanel key={r.phy} radio={r} now={data.now} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
