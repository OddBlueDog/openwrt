import { z } from 'zod';
import { call } from '@/lib/ubus';

// milkflint.devices seen (rpcd.uc): when the router first and last saw each
// device, from dnsmasq's DHCP and neighbour events. Times are epoch seconds,
// keys are lower-case MACs; `since` is when the record began (null: none yet).
const seenSchema = z.object({
  since: z.number().nullable(),
  devices: z.record(z.string(), z.tuple([z.number(), z.number()])),
});
export type Seen = z.output<typeof seenSchema>;

export function getSeen(): Promise<Seen> {
  return call('milkflint.devices', 'seen', {}, seenSchema);
}

/** A device first seen within this long of the record starting may have been there before it. */
const BEFORE_RECORD = 600;

/** While the record is younger than this, a first-seen date says when the records began. */
const YOUNG_RECORD = 7 * 86_400;

const dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const dateTimeFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/** "First seen 3 Nov 2026, 14:05", or "First seen on or before 3 Nov 2026" for a device already there when the record began (either with " (records began 1 Nov 2026)" while the record is under a week old); undefined when it isn't recorded. */
export function firstSeenText(seen: Seen, mac: string): string | undefined {
  const entry = seen.devices[mac.toLowerCase()];
  if (entry === undefined) return undefined;
  const first = new Date(entry[0] * 1000);
  // a record that is only days old can't say when a device really arrived
  const began =
    seen.since !== null && entry[0] - seen.since < YOUNG_RECORD
      ? ` (records began ${dateFormat.format(new Date(seen.since * 1000))})`
      : '';
  if (seen.since !== null && entry[0] - seen.since < BEFORE_RECORD)
    return `First seen on or before ${dateFormat.format(first)}${began}`;
  return `First seen ${dateTimeFormat.format(first)}${began}`;
}
