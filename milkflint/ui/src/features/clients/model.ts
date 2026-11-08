// A device's entry in dhcp: a host section can hold just a name, and only one
// with an address is a reservation.
import { type Change, type Section, str } from '@/lib/api/uci';

/** The address reserved for a device; a section that only names it has none. */
export const reservedIp = (host: Section | undefined): string | undefined => str(host, 'ip');

/** The changes for saving the edit dialog; `section` is the device's host section, if it has one. */
export function editChanges(section: string | undefined, mac: string, name: string, reserve: boolean, ip: string): Change[] {
  if (!reserve && name === '') return section === undefined ? [] : [{ op: 'delete', config: 'dhcp', section }];
  const values = { ...(name === '' ? {} : { name }), ...(reserve ? { ip } : {}) };
  if (section === undefined) return [{ op: 'add', config: 'dhcp', type: 'host', values: { mac, dns: '1', ...values } }];
  const changes: Change[] = [{ op: 'set', config: 'dhcp', section, values }];
  const unset = [...(name === '' ? ['name'] : []), ...(reserve ? [] : ['ip'])];
  if (unset.length > 0) changes.push({ op: 'unset', config: 'dhcp', section, options: unset });
  return changes;
}
