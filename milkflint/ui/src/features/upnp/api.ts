// UPnP's router side: miniupnpd's settings (upnpd.config) and the ports
// devices have open now (milkflint.upnp), named by their DHCP leases.
import { z } from 'zod';
import { getLeases } from '@/lib/api/network';
import { getConfig, type Section } from '@/lib/api/uci';
import { call, exec } from '@/lib/ubus';
import { type UpnpForm, toForm } from './model';

const mappingSchema = z.object({
  proto: z.string(),
  ext_port: z.number(),
  int_addr: z.string(),
  int_port: z.number(),
  remaining: z.number().nullable(),
  description: z.string(),
});

export type Mapping = z.output<typeof mappingSchema> & { device: string | undefined };

export async function getMappings(): Promise<Mapping[]> {
  const [{ mappings }, leases] = await Promise.all([
    call('milkflint.upnp', 'mappings', {}, z.object({ mappings: z.array(mappingSchema) })),
    getLeases().catch(() => []),
  ]);
  const names = new Map(leases.map((l) => [l.ipaddr, l.hostname]));
  return mappings.map((m) => ({ ...m, device: names.get(m.int_addr) }));
}

/** The saved settings; null when miniupnpd isn't installed. */
export async function loadUpnp(): Promise<UpnpForm | null> {
  const s = (await getConfig('upnpd').catch((): Section[] => [])).find((x) => x['.name'] === 'config');
  return s === undefined ? null : toForm(s);
}

/** Close every port devices opened. */
export function clearMappings(): Promise<void> {
  return exec('milkflint.upnp', 'clear');
}
