// A port forward's form (fw4 redirect, DNAT from the internet zone): its
// schema, which needs the firewall's data (the device's network, the
// forwards it would clash with), the form as a forward holds it, and the
// UCI changes it saves. The sheet that edits it is forward-sheet.tsx.
import { z } from 'zod';
import type { Change } from '@/lib/api/uci';
import { type FirewallData, unreservedDevice, zoneForIp } from '../firewall/api';
import { splitList } from '../firewall/forms';
import {
  editSection,
  isAddress,
  isDmz,
  isIpv4,
  isLocalName,
  isShortName,
  lanZone,
  portError,
  portsOverlap,
  protosOverlap,
  type Redirect,
  wanZone,
} from '../firewall/model';

/** The value of the device field that means the router itself. */
export const ROUTER = '@router';

export const protos = ['tcp udp', 'tcp', 'udp'] as const;
export type Proto = (typeof protos)[number];
export const protoLabels: Record<Proto, string> = { 'tcp udp': 'TCP and UDP', tcp: 'TCP', udp: 'UDP' };

/** Well-known services: they fill in the name, protocol and port. */
export const presets: readonly { label: string; name: string; proto: Proto; port: string }[] = [
  { label: 'Minecraft', name: 'Minecraft', proto: 'tcp', port: '25565' },
  { label: 'Minecraft Bedrock', name: 'Minecraft Bedrock', proto: 'udp', port: '19132' },
  { label: 'Plex', name: 'Plex', proto: 'tcp', port: '32400' },
  { label: 'Web server', name: 'Web server', proto: 'tcp', port: '443' },
  { label: 'WireGuard', name: 'WireGuard', proto: 'udp', port: '51820' },
  { label: 'Home Assistant', name: 'Home Assistant', proto: 'tcp', port: '8123' },
];

/** The router's own services: a forward to the router on these ports opens them, its login among them. */
const routerServices: readonly { port: string; label: string }[] = [
  { port: '22', label: 'SSH' },
  { port: '53', label: 'DNS' },
  { port: '80', label: 'web interface' },
  { port: '443', label: 'web interface' },
];

/** Which of the router's services a forward reaches: none for a device, or while its port isn't valid yet. */
export function servicesReached(f: ForwardForm): string[] {
  const port = f.intPort === '' ? f.extPort : f.intPort;
  if (f.ip !== ROUTER || f.dmz || portError(port) !== undefined) return [];
  return [...new Set(routerServices.filter((s) => portsOverlap(s.port, port)).map((s) => s.label))];
}

const forwardFields = z.object({
  name: z.string(),
  proto: z.enum(protos),
  extPort: z.string(),
  /** a device's IPv4 address, or ROUTER */
  ip: z.string(),
  /** typing an address instead of picking a device */
  manual: z.boolean(),
  intPort: z.string(),
  srcIp: z.string(),
  reflection: z.boolean(),
  dmz: z.boolean(),
  dmzConfirmed: z.boolean(),
  /** ticked: forward to the router's own services anyway (servicesReached) */
  routerConfirmed: z.boolean(),
  src: z.string(),
  /** reserve the device's address (when it has none) */
  reserve: z.boolean(),
});

export type ForwardForm = z.infer<typeof forwardFields>;

/** The form's checks for this forward (`original`, undefined for a new one) against the firewall as loaded. */
export function forwardFormSchema(original: Redirect | undefined, data: FirewallData): z.ZodType<ForwardForm, ForwardForm> {
  return forwardFields.superRefine((f, ctx) => {
    const e: Partial<Record<keyof ForwardForm, string>> = {};
    if (!isShortName(f.name)) e.name = 'A short name, e.g. Minecraft server.';
    if (f.ip === '') e.ip = 'Choose the device it goes to.';
    else if (f.ip !== ROUTER && (!isIpv4(f.ip) || zoneForIp(data, f.ip) === undefined))
      e.ip = 'An IPv4 address on one of your networks, e.g. 192.168.1.20.';
    else if (f.ip === data.routerIp || data.networks.some((n) => n.ipv4?.address === f.ip))
      e.ip = 'That’s the router: choose “This router” instead.';
    // every port to the router: its login, DNS and the rest, accepted from wherever the forward comes from
    if (f.dmz && f.ip === ROUTER) e.dmz = 'The router can’t be the DMZ.';
    if (servicesReached(f).length > 0 && !f.routerConfirmed) e.routerConfirmed = 'Tick to confirm.';
    if (!f.dmz) {
      const ext = portError(f.extPort);
      if (ext !== undefined) e.extPort = ext;
      const int = f.intPort === '' ? undefined : portError(f.intPort);
      if (int !== undefined) e.intPort = int;
      if (ext === undefined) {
        const clash = data.cfg.redirects.find(
          (o) =>
            o.section !== original?.section &&
            o.enabled &&
            o.src === f.src &&
            o.target === 'DNAT' &&
            (isDmz(o)
              ? false
              : o.srcDport !== undefined && portsOverlap(o.srcDport, f.extPort) && protosOverlap(o.proto, f.proto.split(' '))),
        );
        if (clash !== undefined) e.extPort = `Already forwarded by “${clash.name ?? clash.label}”.`;
      }
    } else if (!f.dmzConfirmed) {
      e.dmzConfirmed = 'Tick to confirm.';
    }
    const from = splitList(f.srcIp);
    if (from.length > 1) e.srcIp = 'One address or network (for several, add a rule instead).';
    else if (from[0] !== undefined && !isAddress(from[0]))
      e.srcIp = `“${from[0]}” isn’t an address or network like 203.0.113.7 or 203.0.113.0/24.`;
    for (const [path, message] of Object.entries(e)) ctx.addIssue({ code: 'custom', path: [path], message });
  });
}

export function toProto(p: readonly string[]): Proto {
  if (p.length === 1 && (p[0] === 'tcp' || p[0] === 'udp')) return p[0];
  return 'tcp udp';
}

export function formOf(r: Redirect | undefined, data: FirewallData): ForwardForm {
  const src = wanZone(data.cfg)?.name ?? 'wan';
  if (r === undefined) {
    return {
      name: '',
      proto: 'tcp udp',
      extPort: '',
      ip: '',
      manual: false,
      intPort: '',
      srcIp: '',
      reflection: true,
      dmz: false,
      dmzConfirmed: false,
      routerConfirmed: false,
      src,
      reserve: true,
    };
  }
  const ip = r.destIp ?? ROUTER;
  return {
    name: r.name ?? '',
    proto: toProto(r.proto),
    extPort: r.srcDport ?? '',
    ip,
    manual: ip !== ROUTER && !data.devices.some((d) => d.ip === ip),
    intPort: r.destPort ?? r.srcDport ?? '',
    srcIp: r.srcIp.join(' '),
    reflection: r.reflection,
    dmz: isDmz(r),
    dmzConfirmed: isDmz(r),
    routerConfirmed: false,
    src: r.src ?? src,
    reserve: true,
  };
}

export function forwardChanges(f: ForwardForm, original: Redirect | undefined, data: FirewallData): Change[] {
  const toRouter = f.ip === ROUTER;
  const section = original === undefined ? undefined : data.sections.find((s) => s['.name'] === original.section);
  const changes = editSection('redirect', section, {
    name: f.name.trim(),
    src: f.src,
    dest: toRouter ? undefined : (zoneForIp(data, f.ip) ?? lanZone(data.cfg)?.name ?? 'lan'),
    target: 'DNAT',
    proto: f.dmz ? 'all' : f.proto,
    src_dport: f.dmz ? undefined : f.extPort,
    dest_ip: toRouter ? undefined : f.ip,
    dest_port: f.dmz ? undefined : f.intPort === '' ? f.extPort : f.intPort,
    // one address or network: fw4 takes no list here, unlike in rules
    src_ip: f.srcIp.trim() === '' ? undefined : f.srcIp.trim(),
    reflection: f.reflection ? undefined : '0',
  });
  const device = toRouter ? undefined : unreservedDevice(data, f.ip);
  if (f.reserve && device !== undefined) {
    // as the Clients page reserves an address
    changes.push(
      device.host === undefined
        ? {
            op: 'add',
            config: 'dhcp',
            type: 'host',
            values: {
              mac: device.mac,
              ip: f.ip,
              dns: '1',
              ...(device.name === undefined || !isLocalName(device.name) ? {} : { name: device.name }),
            },
          }
        : { op: 'set', config: 'dhcp', section: device.host, values: { ip: f.ip } },
    );
  }
  return changes;
}
