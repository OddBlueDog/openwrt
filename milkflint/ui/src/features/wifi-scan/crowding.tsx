// How crowded each channel of a band is: one bar per 20 MHz channel, as tall
// as the networks sharing it (loud ones count most). On 2.4 GHz a network
// spreads over the channel numbers either side of its own, as it does in
// the air. This router's channels, the quietest place at its width and
// blocks no other network touches at a narrower width are marked.
import type { ReactElement } from 'react';
import { cn } from '@/lib/utils';
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
      : [...marks, ours[0], ours.at(-1), quiet?.[0], quiet?.at(-1), ...(empty ?? []).flatMap((b) => [b[0], b.at(-1)])].filter((c) => c !== undefined),
  );
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex h-28 items-end gap-[3px]">
        {loads.map((l, i) => {
          // a wider gap where the band skips channels (5 GHz: 64 to 100, 144 to 149)
          const prev = loads[i - 1];
          const gap = prev !== undefined && l.channel - prev.channel > (band === '2g' ? 1 : 4);
          const mine = own.has(l.channel);
          return (
            <div
              key={l.channel}
              className={cn('flex h-full min-w-0 flex-1 flex-col justify-end', gap && 'ml-2')}
              title={`Channel ${String(l.channel)}: ${l.networks === 0 ? 'no other networks' : `${String(l.networks)} network${l.networks === 1 ? '' : 's'}`}${mine ? ' (yours)' : ''}`}
            >
              <div
                className={cn(
                  'w-full rounded-t-[3px] transition-[height] duration-500',
                  mine ? 'bg-primary' : quietSet.has(l.channel) ? 'bg-success' : emptySet.has(l.channel) ? 'bg-success/40' : 'bg-muted-foreground/30',
                )}
                style={{ height: `${String(Math.max(3, (l.load / peak) * 100))}%` }}
              />
            </div>
          );
        })}
      </div>
      <div className="flex gap-[3px] border-t pt-1">
        {loads.map((l, i) => {
          const prev = loads[i - 1];
          const gap = prev !== undefined && l.channel - prev.channel > (band === '2g' ? 1 : 4);
          // on 5 and 6 GHz two numbered channels side by side would run together: the second goes
          const crowded = band !== '2g' && prev !== undefined && !gap && numbered.has(prev.channel) && numbered.has(l.channel);
          return (
            <span
              key={l.channel}
              className={cn(
                'min-w-0 flex-1 text-center font-mono text-[9px] leading-none text-muted-foreground tabular',
                gap && 'ml-2',
                own.has(l.channel) && 'font-semibold text-primary',
                (quietSet.has(l.channel) || emptySet.has(l.channel)) && 'text-success',
                (!numbered.has(l.channel) || crowded) && 'invisible',
              )}
            >
              {l.channel}
            </span>
          );
        })}
      </div>
      <span className="sr-only">{bandLabel(band)} channels by how crowded they are</span>
    </div>
  );
}
