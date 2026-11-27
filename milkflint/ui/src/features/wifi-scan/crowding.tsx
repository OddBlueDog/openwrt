// How crowded each channel of a band is: one bar per 20 MHz channel, as tall
// as the networks sharing it (loud ones count most). On 2.4 GHz a network
// spreads over the channel numbers either side of its own, as it does in
// the air. This router's channels, the quietest place at its width and
// blocks no other network touches at a narrower width are marked.
import type { ReactElement } from 'react';
import { type BarLabel, type BarPart, BarChart } from '@/components/charts/bar-chart';
import { bandLabel, type BandId, type ChannelLoad } from './spectrum';

export function ChannelCrowding({
  band,
  loads,
  own,
  quiet,
  empty,
  marks,
}: {
  band: BandId;
  loads: readonly ChannelLoad[];
  /** This router's 20 MHz channels on the band (2.4 GHz: its own channel number). */
  own: ReadonlySet<number>;
  quiet: readonly number[] | undefined;
  /** Narrower blocks no other network touches, when the quietest at this router's width isn't empty. */
  empty?: readonly (readonly number[])[] | undefined;
  /** Channels to number (2.4 GHz numbers all of them); the ends of this router's and the quietest block are too. */
  marks: readonly number[];
}): ReactElement {
  const peak = Math.max(1, ...loads.map((l) => l.load));
  const quietSet = new Set(quiet ?? []);
  const emptySet = new Set((empty ?? []).flat());
  const ours = loads.filter((l) => own.has(l.channel)).map((l) => l.channel);
  const numbered = new Set(
    band === '2g'
      ? loads.map((l) => l.channel)
      : [...marks, ours[0], ours.at(-1), quiet?.[0], quiet?.at(-1), ...(empty ?? []).flatMap((b) => [b[0], b.at(-1)])].filter(
          (c) => c !== undefined,
        ),
  );
  // the channels left to right, and a space where the band skips some (5 GHz: 64 to 100, 144 to 149)
  const places = loads.flatMap((l, i) => {
    const prev = loads[i - 1];
    return prev !== undefined && l.channel - prev.channel > (band === '2g' ? 1 : 4) ? [null, l] : [l];
  });
  const bars = places.map((l): BarPart[] | null =>
    l === null
      ? null
      : [
          {
            value: Math.max(3, (l.load / peak) * 100),
            color: own.has(l.channel)
              ? 'var(--primary)'
              : quietSet.has(l.channel)
                ? 'var(--success)'
                : emptySet.has(l.channel)
                  ? 'color-mix(in oklab, var(--success) 40%, transparent)'
                  : 'color-mix(in oklab, var(--muted-foreground) 30%, transparent)',
          },
        ],
  );
  const labels = places.flatMap((l, at): BarLabel[] => {
    const prev = places[at - 1];
    // on 5 and 6 GHz two numbered channels side by side would run together: the second goes
    const crowded = band !== '2g' && prev !== undefined && prev !== null && numbered.has(prev.channel);
    if (l === null || !numbered.has(l.channel) || crowded) return [];
    const mine = own.has(l.channel);
    const marked = quietSet.has(l.channel) || emptySet.has(l.channel);
    return [{ at, text: String(l.channel), color: mine ? 'var(--primary)' : marked ? 'var(--success)' : undefined, bold: mine }];
  });
  return (
    <BarChart
      bars={bars}
      max={100}
      baseline
      labels={labels}
      label={`${bandLabel(band)} channels by how crowded they are`}
      card={(at) => {
        const l = places[at];
        if (l === null || l === undefined) return { rows: [] };
        const others = l.networks === 0 ? 'no other networks' : `${String(l.networks)} network${l.networks === 1 ? '' : 's'}`;
        return { title: `Channel ${String(l.channel)}: ${others}${own.has(l.channel) ? ' (yours)' : ''}`, rows: [] };
      }}
      className="h-34"
    />
  );
}
