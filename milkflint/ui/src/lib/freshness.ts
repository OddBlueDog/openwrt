// The words of a Freshness line: how long ago a poll answered and when it asks next.
import { formatDurationShort } from '@/lib/format';

const span = (ms: number): string => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return seconds < 60 ? `${seconds} s` : formatDurationShort(seconds);
};

export function freshnessText(now: number, at: number | undefined, next: number | undefined): string {
  if (at === undefined) return '';
  if (next === undefined) return `Updated ${span(now - at)} ago`;
  if (now >= next) return 'Updating…';
  return `Updated ${span(now - at)} ago · next in ${span(next - now)}`;
}
