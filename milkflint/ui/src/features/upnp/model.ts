// UPnP's settings form: on or off, secure mode, and the two protocols, as
// upnpd.config holds them, with the UCI changes that save them.
import { z } from 'zod';
import { bool, type Change, type Section } from '@/lib/api/uci';

export const upnpFormSchema = z.object({
  enabled: z.boolean(),
  upnp: z.boolean(),
  natpmp: z.boolean(),
  secure: z.boolean(),
});

export type UpnpForm = z.infer<typeof upnpFormSchema>;

/** upnpd.config as the form shows it (each protocol and secure mode on unless set off). */
export function toForm(s: Section): UpnpForm {
  return {
    enabled: bool(s, 'enabled'),
    upnp: bool(s, 'enable_upnp', true),
    natpmp: bool(s, 'enable_natpmp', true),
    secure: bool(s, 'secure_mode', true),
  };
}

export const toChanges = (f: UpnpForm): Change[] => [
  {
    op: 'set',
    config: 'upnpd',
    section: 'config',
    values: {
      enabled: f.enabled ? '1' : '0',
      enable_upnp: f.upnp ? '1' : '0',
      enable_natpmp: f.natpmp ? '1' : '0',
      secure_mode: f.secure ? '1' : '0',
    },
  },
];
