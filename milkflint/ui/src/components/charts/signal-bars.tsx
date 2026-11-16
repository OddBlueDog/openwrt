import type { ReactElement } from 'react';
import { cn } from '@/lib/utils';

/** Four bars for a received signal in dBm: -55 or better is full. */
export function SignalBars({ dbm, className }: { dbm: number | undefined; className?: string }): ReactElement {
  const level = dbm === undefined ? 0 : dbm >= -55 ? 4 : dbm >= -65 ? 3 : dbm >= -72 ? 2 : dbm >= -80 ? 1 : 0;
  const tone = level >= 3 ? 'bg-success' : level === 2 ? 'bg-warning' : 'bg-destructive';
  return (
    <span className={cn('inline-flex h-3.5 items-end gap-[2px]', className)} aria-hidden="true">
      {[1, 2, 3, 4].map((bar) => (
        <span
          key={bar}
          className={cn('w-[3px] rounded-[1px]', bar <= level ? tone : 'bg-muted-foreground/25')}
          style={{ height: `${String(bar * 25)}%` }}
        />
      ))}
    </span>
  );
}

/** What SNR means, for a hint wherever it shows. */
export const SNR_HINT =
  'Signal-to-noise ratio: how far the signal stands above the noise on the channel. 25 dB or more is good; under 15 dB is poor.';

/** Bars, the signal and, when the noise is known, the SNR: "-62 dBm · SNR 31 dB". */
export function SignalReading({
  dbm,
  snr,
  empty = '',
  className,
}: {
  dbm: number | undefined;
  snr: number | undefined;
  empty?: string;
  className?: string;
}): ReactElement {
  return (
    <span className={cn('flex items-center gap-2 tabular', className)}>
      <SignalBars dbm={dbm} />
      <span className="text-xs whitespace-nowrap text-muted-foreground">
        {dbm === undefined ? empty : `${String(dbm)} dBm`}
        {dbm !== undefined && snr !== undefined && (
          <span title={SNR_HINT} className="cursor-help">
            {' · '}SNR {String(snr)} dB
          </span>
        )}
      </span>
    </span>
  );
}
