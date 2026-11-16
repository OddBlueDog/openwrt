// Opening a port: a port forward (fw4 redirect, DNAT from the internet zone)
// edited in a side sheet. It starts from the device, offers common
// services, reserves the device's address so the forward keeps working, and
// shows the section as /etc/config/firewall will hold it.
import { ChevronRightIcon, Trash2Icon, TriangleAlertIcon } from 'lucide-react';
import { type ReactElement, useId, useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { Change } from '@/lib/api/uci';
import { type FirewallData, unreservedDevice, zoneForIp } from '../firewall/api';
import { splitList } from '../firewall/forms';
import {
  editSection,
  isAddress,
  isDmz,
  isInternetZone,
  isIpv4,
  isLocalName,
  isShortName,
  lanZone,
  portError,
  portsOverlap,
  protosOverlap,
  type Redirect,
  wanZone,
  zonePhrase,
  zoneTitle,
} from '../firewall/model';
import { DeviceSelect, DialogField, SwitchRow } from '../firewall/parts';
import { UciPreview } from '../firewall/sheet-parts';
import { EditorSheet } from '@/components/editor-sheet';

const ROUTER = '@router';

type Proto = 'tcp udp' | 'tcp' | 'udp';
const protoLabels: Record<Proto, string> = { 'tcp udp': 'TCP and UDP', tcp: 'TCP', udp: 'UDP' };

/** Well-known services: they fill in the name, protocol and port. */
const presets: readonly { label: string; name: string; proto: Proto; port: string }[] = [
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
function servicesReached(f: ForwardForm): string[] {
  const port = f.intPort === '' ? f.extPort : f.intPort;
  if (f.ip !== ROUTER || f.dmz || portError(port) !== undefined) return [];
  return [...new Set(routerServices.filter((s) => portsOverlap(s.port, port)).map((s) => s.label))];
}

interface ForwardForm {
  name: string;
  proto: Proto;
  extPort: string;
  /** a device's IPv4 address, or ROUTER */
  ip: string;
  /** typing an address instead of picking a device */
  manual: boolean;
  intPort: string;
  srcIp: string;
  reflection: boolean;
  dmz: boolean;
  dmzConfirmed: boolean;
  /** ticked: forward to the router's own services anyway (servicesReached) */
  routerConfirmed: boolean;
  src: string;
  /** reserve the device's address (when it has none) */
  reserve: boolean;
}

function toProto(p: readonly string[]): Proto {
  if (p.length === 1 && (p[0] === 'tcp' || p[0] === 'udp')) return p[0];
  return 'tcp udp';
}

function formOf(r: Redirect | undefined, data: FirewallData): ForwardForm {
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

function forwardChanges(f: ForwardForm, original: Redirect | undefined, data: FirewallData): Change[] {
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

function validate(
  f: ForwardForm,
  original: Redirect | undefined,
  data: FirewallData,
): Partial<Record<keyof ForwardForm, string>> {
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
  return e;
}

/** "I understand", for a choice that opens more than it seems to. */
function Understood({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }): ReactElement {
  return (
    <label className="mt-1 flex min-h-6 items-center gap-2 font-medium text-foreground">
      <input
        type="checkbox"
        className="size-4 accent-primary"
        checked={checked}
        onChange={(e) => {
          onChange(e.target.checked);
        }}
      />
      I understand
    </label>
  );
}

export function ForwardSheet({
  forward,
  data,
  onClose,
  onSave,
  onDelete,
}: {
  forward: Redirect | undefined;
  data: FirewallData;
  onClose: () => void;
  onSave: (changes: Change[]) => void;
  /** asks first, then deletes the forward (an existing one only) */
  onDelete?: (() => void) | undefined;
}): ReactElement {
  const id = useId();
  const [f, setF] = useState(() => formOf(forward, data));
  const [more, setMore] = useState(
    () => f.srcIp !== '' || !f.reflection || f.dmz || f.src !== (wanZone(data.cfg)?.name ?? 'wan'),
  );
  const set = <K extends keyof ForwardForm>(key: K, value: ForwardForm[K]): void => {
    setF((x) => ({ ...x, [key]: value }));
  };
  const errors = validate(f, forward, data);
  const device = f.ip === ROUTER ? undefined : unreservedDevice(data, f.ip);
  const fromInternet = data.cfg.zones.some((z) => z.name === f.src && isInternetZone(z));
  const from = fromInternet ? 'the internet' : zonePhrase(f.src, 'src', data.cfg);
  const services = servicesReached(f);
  const section = forward === undefined ? undefined : data.sections.find((s) => s['.name'] === forward.section);
  const valid = Object.keys(errors).length === 0;
  const missing = [
    f.ip === '' ? 'the device' : undefined,
    f.name.trim() === '' ? 'a name' : undefined,
    !f.dmz && f.extPort === '' ? 'the internet port' : undefined,
  ].filter((x) => x !== undefined);
  const changes = forwardChanges(f, forward, data);
  // a field nobody has typed in yet isn't wrong yet: Save just stays off until it's filled
  const shown = (key: keyof ForwardForm): string | undefined => (f[key] === '' ? undefined : errors[key]);
  const invalid = (key: keyof ForwardForm): { 'aria-invalid': boolean } => ({ 'aria-invalid': shown(key) !== undefined });

  return (
    <EditorSheet
      title={forward === undefined ? 'Open a port' : (forward.name ?? 'Edit port forward')}
      description={
        fromInternet
          ? 'Connections from the internet to your router on this port go on to the device you choose.'
          : `Connections from ${zonePhrase(f.src, 'src', data.cfg)} to the router on this port go on to the device you choose.`
      }
      onClose={onClose}
      status={
        <>
          {forward !== undefined && onDelete !== undefined && (
            <Button variant="ghost" className="-ml-2 text-destructive hover:text-destructive" onClick={onDelete}>
              <Trash2Icon /> Delete
            </Button>
          )}
          {!valid && (
            <p className="text-xs text-muted-foreground">
              {missing.length > 0
                ? `Still needed: ${new Intl.ListFormat('en-GB').format(missing)}.`
                : 'Fix what’s marked to save.'}
            </p>
          )}
        </>
      }
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={f.dmz ? 'destructive' : 'default'}
            disabled={!valid || (forward !== undefined && changes.length === 0)}
            onClick={() => {
              onSave(changes);
            }}
          >
            {forward === undefined ? 'Open the port' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5 px-6 py-5">
        {forward === undefined && (
          <div className="grid gap-2">
            <span id={`${id}-presets`} className="text-sm font-medium">
              Common services
            </span>
            <div className="flex flex-wrap gap-1.5" role="group" aria-labelledby={`${id}-presets`}>
              {presets.map((p) => {
                const picked = f.name === p.name && f.extPort === p.port && f.proto === p.proto;
                return (
                  <button
                    key={p.label}
                    type="button"
                    aria-pressed={picked}
                    onClick={() => {
                      setF((x) => ({ ...x, name: p.name, proto: p.proto, extPort: p.port, intPort: p.port }));
                    }}
                    className={
                      picked
                        ? 'h-8 rounded-md border border-primary bg-primary-subtle px-2.5 text-xs font-medium text-primary-subtle-foreground'
                        : 'h-8 rounded-md border bg-card px-2.5 text-xs text-foreground hover:bg-accent'
                    }
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <DialogField id={`${id}-device`} label="Device" error={shown('ip')}>
          {f.manual ? (
            <Input
              id={`${id}-device`}
              className="font-mono"
              value={f.ip}
              placeholder="192.168.1.20"
              {...invalid('ip')}
              onChange={(e) => {
                set('ip', e.target.value.trim());
              }}
            />
          ) : (
            <DeviceSelect
              id={`${id}-device`}
              devices={data.devices.filter((d) => d.ip !== undefined && isIpv4(d.ip) && d.ip !== data.routerIp)}
              value={f.ip}
              by="ip"
              extra={[{ value: ROUTER, label: 'This router' }]}
              onChange={(v) => {
                set('ip', v);
              }}
            />
          )}
          <button
            type="button"
            className="min-h-6 w-fit text-xs link underline-offset-4"
            onClick={() => {
              setF((x) => ({ ...x, manual: !x.manual, ip: x.manual ? '' : x.ip === ROUTER ? '' : x.ip }));
            }}
          >
            {f.manual ? 'Choose from your devices' : 'Type an address instead'}
          </button>
        </DialogField>
        {device !== undefined && errors.ip === undefined && (
          <SwitchRow
            id={`${id}-reserve`}
            boxed
            checked={f.reserve}
            onChange={(v) => {
              set('reserve', v);
            }}
            title={`Keep ${f.ip} for ${device.name ?? 'this device'}`}
            hint="So the device gets the same address every time and the forward keeps working."
            why="Reserves the address as the Clients page does: a host entry in /etc/config/dhcp with the device’s MAC address. Without it, the device can get another address and the forward then goes nowhere."
          />
        )}
        <DialogField id={`${id}-name`} label="Name" error={shown('name')}>
          <Input
            id={`${id}-name`}
            value={f.name}
            placeholder="Minecraft server"
            {...invalid('name')}
            onChange={(e) => {
              set('name', e.target.value);
            }}
          />
        </DialogField>
        {!f.dmz && (
          <div className="grid gap-1.5">
            <div className="grid gap-3 sm:grid-cols-3">
              <DialogField id={`${id}-proto`} label="Protocol">
                <Select
                  value={f.proto}
                  onValueChange={(v) => {
                    set('proto', toProto(v.split(' ')));
                  }}
                >
                  <SelectTrigger id={`${id}-proto`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(protoLabels).map(([k, l]) => (
                      <SelectItem key={k} value={k}>
                        {l}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </DialogField>
              <DialogField id={`${id}-ext`} label="Internet port" error={shown('extPort')}>
                <Input
                  id={`${id}-ext`}
                  inputMode="numeric"
                  className="tabular"
                  value={f.extPort}
                  placeholder="25565"
                  {...invalid('extPort')}
                  onChange={(e) => {
                    const extPort = e.target.value.trim();
                    setF((x) => ({ ...x, extPort, intPort: x.intPort === '' || x.intPort === x.extPort ? extPort : x.intPort }));
                  }}
                />
              </DialogField>
              <DialogField id={`${id}-int`} label="Device port" error={shown('intPort')}>
                <Input
                  id={`${id}-int`}
                  inputMode="numeric"
                  className="tabular"
                  value={f.intPort}
                  placeholder={f.extPort === '' ? 'same' : f.extPort}
                  {...invalid('intPort')}
                  onChange={(e) => {
                    set('intPort', e.target.value.trim());
                  }}
                />
              </DialogField>
            </div>
            <p className="text-xs text-muted-foreground">
              The app’s or game’s help lists them. A range like 27015-27030 works too.
            </p>
            <p className="text-xs text-muted-foreground">
              Open only what it needs: anyone on the internet can reach each open port.
            </p>
          </div>
        )}
        {services.length > 0 && (
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertTitle>
              This opens the router’s {new Intl.ListFormat('en-GB').format(services)} to {from}
            </AlertTitle>
            <AlertDescription>
              Anyone there can reach it and try its login. To reach the router from outside, a VPN such as WireGuard is safer.
              <Understood
                checked={f.routerConfirmed}
                onChange={(v) => {
                  set('routerConfirmed', v);
                }}
              />
            </AlertDescription>
          </Alert>
        )}
        <div className="flex flex-col gap-4">
          <button
            type="button"
            aria-expanded={more}
            aria-controls={`${id}-more`}
            className="flex min-h-6 w-fit items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground"
            onClick={() => {
              setMore((m) => !m);
            }}
          >
            <ChevronRightIcon
              className={
                more ? 'size-4 rotate-90 transition-transform duration-fast' : 'size-4 transition-transform duration-fast'
              }
            />{' '}
            More settings
          </button>
          <div id={`${id}-more`} hidden={!more} className="grid gap-5 border-l-2 pl-4">
            <DialogField
              id={`${id}-src-ip`}
              label="Only from"
              hint="The one address or network allowed to connect, e.g. a friend’s. Empty: anyone."
              why="Writes src_ip. fw4 takes one address or network here; for several, add a traffic rule on the Firewall page instead."
              error={shown('srcIp')}
            >
              <Input
                id={`${id}-src-ip`}
                className="font-mono"
                value={f.srcIp}
                placeholder="Anyone"
                {...invalid('srcIp')}
                onChange={(e) => {
                  set('srcIp', e.target.value);
                }}
              />
            </DialogField>
            <SwitchRow
              id={`${id}-reflection`}
              checked={f.reflection}
              onChange={(v) => {
                set('reflection', v);
              }}
              title="Works from home too (NAT loopback)"
              hint="Devices at home can use your internet address and this port, as friends outside do."
              why="Off, it works from outside only. Writes reflection '0' when off; on is fw4’s default, so the option is left unset."
            />
            <DialogField
              id={`${id}-src`}
              label="Comes from"
              hint="The zone the connections arrive from: the internet, usually."
              why="Writes src, the firewall zone; the internet zone is OpenWrt’s wan."
            >
              <Select
                value={f.src}
                onValueChange={(v) => {
                  set('src', v);
                }}
              >
                <SelectTrigger id={`${id}-src`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {data.cfg.zones.map((z) => (
                    <SelectItem key={z.name} value={z.name}>
                      {zoneTitle(z.name, data.cfg)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </DialogField>
            <SwitchRow
              id={`${id}-dmz`}
              checked={f.dmz}
              onChange={(v) => {
                setF((x) => ({ ...x, dmz: v, dmzConfirmed: false }));
              }}
              title="Every port (DMZ)"
              hint="Forwards all traffic the router doesn’t handle itself to this device."
              why="Writes proto 'all' with no ports: every connection from the internet that isn’t a reply or another forward goes to the device."
            />
            {f.dmz && f.ip === ROUTER && (
              <Alert variant="destructive">
                <TriangleAlertIcon />
                <AlertTitle>The router can’t be the DMZ</AlertTitle>
                <AlertDescription>
                  That would open its login and every service on it to {from}. Choose a device, or forward just the ports a
                  service on the router needs.
                </AlertDescription>
              </Alert>
            )}
            {f.dmz && f.ip !== ROUTER && (
              <Alert variant="destructive">
                <TriangleAlertIcon />
                <AlertTitle>The whole device is open to {from}</AlertTitle>
                <AlertDescription>
                  Every service on it can be reached and attacked by anyone there. Forward just the ports it needs instead if you
                  can.
                  <Understood
                    checked={f.dmzConfirmed}
                    onChange={(v) => {
                      set('dmzConfirmed', v);
                    }}
                  />
                </AlertDescription>
              </Alert>
            )}
          </div>
        </div>
        {fromInternet && (
          <p className="text-xs text-muted-foreground">
            To test it, connect from outside, e.g. a phone on mobile data: from home it only works with NAT loopback.
          </p>
        )}
      </div>
      <div className="border-t px-6 py-5">
        <UciPreview type="redirect" original={section} changes={changes} />
      </div>
    </EditorSheet>
  );
}
