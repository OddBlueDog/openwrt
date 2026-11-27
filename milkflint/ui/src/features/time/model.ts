// Name & time's form: the router's name, its time zone and internet time
// (NTP), with the UCI changes that save them.
import { z } from 'zod';
import type { Change } from '@/lib/api/uci';

const HOSTNAME = /^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
const SERVER = /^[A-Za-z0-9.-]+$/;

export function serversOf(text: string): string[] {
  return text.split(/[\s,]+/).filter((s) => s !== '');
}

export const timeFormSchema = z
  .object({
    section: z.string(),
    hostname: z.string().regex(HOSTNAME, 'Letters, digits and hyphens, not starting or ending with a hyphen.'),
    /** '' until a time zone is picked (./zone.ts): the router stays on UTC */
    zonename: z.string(),
    ntp: z.boolean(),
    servers: z.string(),
  })
  .superRefine((f, ctx) => {
    if (f.ntp && (serversOf(f.servers).length === 0 || !serversOf(f.servers).every((s) => SERVER.test(s))))
      ctx.addIssue({ code: 'custom', path: ['servers'], message: 'One server name per line, e.g. 0.openwrt.pool.ntp.org.' });
  });

export type TimeForm = z.infer<typeof timeFormSchema>;

export interface TimeData {
  form: TimeForm;
  zones: { name: string; tz: string }[];
  ntpSection: string | undefined;
}

export function toChanges(f: TimeForm, data: TimeData): Change[] {
  // the zone only when it changed: its rule comes from the list, which may not have loaded
  const zone =
    f.zonename === data.form.zonename
      ? {}
      : { zonename: f.zonename, timezone: data.zones.find((z) => z.name === f.zonename)?.tz ?? 'UTC0' };
  const changes: Change[] = [{ op: 'set', config: 'system', section: f.section, values: { hostname: f.hostname, ...zone } }];
  const ntp = { enabled: f.ntp ? '1' : '0', server: serversOf(f.servers) };
  changes.push(
    data.ntpSection === undefined
      ? { op: 'add', config: 'system', type: 'timeserver', name: 'ntp', values: ntp }
      : { op: 'set', config: 'system', section: data.ntpSection, values: ntp },
  );
  return changes;
}
