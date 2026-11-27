// The IPv6 page's form: the mode (native, pass-through, off), how devices
// get addresses, and the local (ULA) prefix, with the UCI changes that save
// them.
import { z } from 'zod';
import type { Change } from '@/lib/api/uci';

export const modes = {
  native: { label: 'Native', hint: 'Your provider delegates a prefix; the router gives each device its own IPv6 address.' },
  relay: {
    label: 'Pass-through',
    hint: "Relays your provider's IPv6 straight to devices. For providers that don't delegate a prefix.",
  },
  off: { label: 'Off', hint: 'No IPv6 on the internet port or for devices.' },
} as const;
export type Mode = keyof typeof modes;

export const addressing = {
  slaac: { label: 'Automatic (SLAAC)', hint: 'Devices make their own addresses. Works with everything, including Android.' },
  both: { label: 'SLAAC + DHCPv6', hint: 'Devices make their own addresses, and can also ask the router for one.' },
  dhcpv6: { label: 'DHCPv6 only', hint: 'The router hands out every address. Android devices don’t support this.' },
} as const;
export type Addressing = keyof typeof addressing;

export const ipv6FormSchema = z.object({
  mode: z.enum(['native', 'relay', 'off']),
  addressing: z.enum(['slaac', 'both', 'dhcpv6']),
  ula: z
    .string()
    .refine(
      (v) => v === '' || /^f[cd][0-9a-f]{2}:[0-9a-f:]+\/(4[89]|5\d|6[0-4])$/i.test(v),
      'A ULA prefix like fd12:3456:789a::/48.',
    ),
});

export type Ipv6Form = z.infer<typeof ipv6FormSchema>;

export interface Ipv6Data {
  form: Ipv6Form;
  wan6Exists: boolean;
  dhcpWan6Exists: boolean;
}

export function toChanges(f: Ipv6Form, data: Ipv6Data): Change[] {
  const changes: Change[] = [];
  const wan6 = { disabled: f.mode === 'off' ? '1' : '0' };
  changes.push(
    data.wan6Exists
      ? { op: 'set', config: 'network', section: 'wan6', values: wan6 }
      : { op: 'add', config: 'network', type: 'interface', name: 'wan6', values: { ...wan6, device: '@wan', proto: 'dhcpv6' } },
  );
  if (f.ula !== '') changes.push({ op: 'set', config: 'network', section: 'globals', values: { ula_prefix: f.ula } });

  if (f.mode === 'relay') {
    const relay = { ra: 'relay', dhcpv6: 'relay', ndp: 'relay' };
    changes.push(
      data.dhcpWan6Exists
        ? { op: 'set', config: 'dhcp', section: 'wan6', values: { ...relay, interface: 'wan6', master: '1' } }
        : {
            op: 'add',
            config: 'dhcp',
            type: 'dhcp',
            name: 'wan6',
            values: { ...relay, interface: 'wan6', master: '1', ignore: '1' },
          },
    );
    changes.push({ op: 'set', config: 'dhcp', section: 'lan', values: relay });
  } else {
    if (data.dhcpWan6Exists) changes.push({ op: 'delete', config: 'dhcp', section: 'wan6' });
    if (f.mode === 'off') {
      changes.push({
        op: 'set',
        config: 'dhcp',
        section: 'lan',
        values: { ra: 'disabled', dhcpv6: 'disabled', ndp: 'disabled' },
      });
    } else {
      changes.push({
        op: 'set',
        config: 'dhcp',
        section: 'lan',
        values: {
          ra: 'server',
          dhcpv6: f.addressing === 'slaac' ? 'disabled' : 'server',
          ndp: 'disabled',
          ra_slaac: f.addressing === 'dhcpv6' ? '0' : '1',
          ra_flags: f.addressing === 'slaac' ? ['none'] : ['managed-config', 'other-config'],
        },
      });
    }
  }
  return changes;
}
