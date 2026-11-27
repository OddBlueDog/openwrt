// Network quality's settings form: what the probe measures and how often
// (milkflint.netquality), its checks and the UCI changes that save it.
import { z } from 'zod';
import type { Change } from '@/lib/api/uci';

export const pingTargets = [
  { value: '1.1.1.1', label: 'Cloudflare (1.1.1.1)' },
  { value: '8.8.8.8', label: 'Google (8.8.8.8)' },
  { value: '9.9.9.9', label: 'Quad9 (9.9.9.9)' },
] as const;

const HOST = /^[A-Za-z0-9.:-]+$/;
// an IPv4 address, #port optional (the probe's dns-path.uc takes the same)
const DNS_SERVER = /^(\d{1,3}\.){3}\d{1,3}(#\d{1,5})?$/;

export const qualityFormSchema = z
  .object({
    enabled: z.boolean(),
    interval: z.string(),
    pingTarget: z.string(),
    customTarget: z.string(),
    dnsDomain: z.string().regex(/^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/, 'A domain name, e.g. openwrt.org.'),
    /** A DNS server to time instead of the ones devices use; '' for those. */
    dnsServer: z
      .string()
      .refine((v) => v === '' || DNS_SERVER.test(v), 'An IPv4 address, with #port when it isn’t 53, e.g. 127.0.0.1#5354.'),
    routes: z.boolean(),
  })
  .superRefine((f, ctx) => {
    if (f.pingTarget === 'custom' && !HOST.test(f.customTarget))
      ctx.addIssue({ code: 'custom', path: ['customTarget'], message: 'An IP address or host name.' });
  });

export type QualityForm = z.infer<typeof qualityFormSchema>;

export function toChanges(f: QualityForm, saved: QualityForm): Change[] {
  return [
    {
      op: 'set',
      config: 'milkflint',
      section: 'netquality',
      values: {
        enabled: f.enabled ? '1' : '0',
        interval: f.interval,
        ping_target: f.pingTarget === 'custom' ? f.customTarget : f.pingTarget,
        dns_domain: f.dnsDomain,
        ...(f.dnsServer === '' ? {} : { dns_server: f.dnsServer }),
        routes: f.routes ? '1' : '0',
      },
    },
    ...(f.dnsServer === '' && saved.dnsServer !== ''
      ? [{ op: 'unset' as const, config: 'milkflint', section: 'netquality', options: ['dns_server'] }]
      : []),
  ];
}
