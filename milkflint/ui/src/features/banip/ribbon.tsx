// The status card's lower edge: the last day of drops, a bar for every five
// minutes, the height by how many (on a square-root scale, so one busy spell
// doesn't flatten the rest), on a baseline: the day goes on whether anything
// knocked or not. Hovering or touching it says the slot's time and count;
// the whole is also said in words, for screen readers.
import type { ReactElement } from 'react';
import { type BarLabel, BarChart } from '@/components/charts/bar-chart';
import { formatNumber } from '@/lib/format';

const SLOTS = 288;
const LABELS: readonly BarLabel[] = [
  { at: 0, text: '24 h ago', align: 'start' },
  { at: 72, text: '18 h', align: 'start' },
  { at: 144, text: '12 h', align: 'start' },
  { at: 216, text: '6 h', align: 'start' },
  { at: SLOTS - 1, text: 'now', align: 'end' },
];
const FILL = 'color-mix(in oklab, var(--primary) 78%, transparent)';

export function DropRibbon({
  values,
  end,
  step,
  summary,
}: {
  /** oldest first, one per slot */
  values: readonly number[];
  /** the newest slot's start, epoch seconds */
  end: number | null | undefined;
  step: number;
  summary: string;
}): ReactElement {
  const v = values.slice(-SLOTS);
  const pad = SLOTS - v.length;
  const max = Math.max(1, ...v);
  const count = (at: number): number => (at < pad ? 0 : (v[at - pad] ?? 0));
  // in percent of the tallest; a slot with any drops stays in sight
  const bars = Array.from({ length: SLOTS }, (_, at) => {
    const x = count(at);
    return x <= 0 ? [] : [{ value: Math.max(8, Math.sqrt(x / max) * 100), color: FILL }];
  });
  return (
    <div className="border-t bg-muted/40 px-5 pt-3 pb-2 sm:px-6">
      <BarChart
        bars={bars}
        max={100}
        gap={0.3}
        baseline
        cursor="line"
        labels={LABELS}
        label={summary}
        card={(at) => {
          const n = count(at);
          const drops = `${formatNumber(n)} ${n === 1 ? 'drop' : 'drops'}`;
          if (end === null || end === undefined) return { title: drops, rows: [] };
          const time = new Date((end - (SLOTS - 1 - at) * step) * 1000);
          return { title: `${time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}, ${drops}`, rows: [] };
        }}
        className="h-17"
      />
    </div>
  );
}
