// Remote access: a WireGuard server on the router (wg_in) that phones and
// laptops connect to from anywhere. It opens on the answer (on or off, the
// devices and when each last connected, and whether the internet can reach
// the router at all), then the devices, a side sheet each with its QR code
// and .conf file, then the settings. "What this sets up" says in words what
// a save will do; the save result says what it did.
import { pageLink } from '@/lib/router';
import { Link } from '@tanstack/react-router';
import {
  ChevronRightIcon,
  DownloadIcon,
  LoaderCircleIcon,
  PlusIcon,
  QrCodeIcon,
  Trash2Icon,
  TriangleAlertIcon,
  Undo2Icon,
} from 'lucide-react';
import { useSuspenseQuery } from '@tanstack/react-query';
import { evaluate } from '@tanstack/react-form';
import { type ReactElement, type ReactNode, useCallback, useMemo, useRef, useState } from 'react';
import { ApplyStatus } from '@/components/apply-status';
import { CardHeading } from '@/components/card-heading';
import { type Column, DataTable } from '@/components/data-table';
import { EditorSheet } from '@/components/editor-sheet';
import { Field } from '@/components/field';
import { PageHeader } from '@/components/layout/page-header';
import { Note } from '@/components/note';
import { PageBoundary } from '@/components/page-boundary';
import { QrCode } from '@/components/qr-code';
import { SaveBar } from '@/components/save-bar';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useApply } from '@/hooks/use-apply';
import { isConnected, type WgInterface, type WgPeer } from '@/lib/api/wireguard';
import { useFormValues, useSettingsForm } from '@/lib/form/use-settings-form';
import { useLive } from '@/lib/query/use-live';
import { formatDuration } from '@/lib/format';
import { cn, errorMessage } from '@/lib/utils';
import { MoreSettings } from '@/components/more-settings';
import { remoteAccessQueries, useNewKeys, useRenewServer } from './queries';
import {
  confFileName,
  describe,
  drift,
  endpointHost,
  type Errors,
  moveTo,
  newPeerSection,
  nextPeerIp,
  type PeerForm,
  peerConfig,
  peerLabel,
  reachOf,
  removal,
  type ServerData,
  type ServerForm,
  subnetOf,
  serverErrors,
  serverFormKeys,
  serverFormSchema,
  summary,
  toChanges,
} from './model';
import { CheckItem, Cell, NoWireGuard, Traffic } from './parts';
import { PEER_TYPE, SERVER } from './sections';
import { explain } from '@/components/explain';

type Tone = 'connected' | 'seen' | 'never' | 'paused' | 'off';

/** A device's state from the running interface, on the router's clock. */
function peerState(
  peer: PeerForm,
  status: WgPeer | undefined,
  now: number,
  running: boolean,
): { tone: Tone; text: string; from?: string } {
  if (!running) return { tone: 'off', text: 'Remote access is off' };
  if (!peer.enabled || status === undefined) return { tone: 'paused', text: 'Paused' };
  if (status.latest_handshake === 0) return { tone: 'never', text: 'Never connected yet' };
  const from = status.endpoint === null ? undefined : status.endpoint.replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
  if (isConnected(status, now)) return { tone: 'connected', text: 'Connected', ...(from === undefined ? {} : { from }) };
  return { tone: 'seen', text: `Last connected ${formatDuration(now - status.latest_handshake)} ago` };
}

function StateBadge({ tone, text }: { tone: Tone; text: string }): ReactElement {
  return (
    <Badge variant={tone === 'connected' ? 'success' : tone === 'seen' || tone === 'never' ? 'outline' : 'secondary'}>
      {text}
    </Badge>
  );
}

interface Row {
  peer: PeerForm;
  status: WgPeer | undefined;
  state: ReturnType<typeof peerState>;
}

/** The columns; the last is a row's open button (the row opens it too). */
function peerColumns(onOpen: (section: string) => void): Column<Row>[] {
  return [
    {
      label: 'Device',
      cell: ({ peer }) => <span className="block truncate">{peerLabel(peer)}</span>,
      className: 'max-w-64 font-medium',
    },
    { label: 'Address', cell: ({ peer }) => <span className="font-mono text-xs">{peer.ip}</span> },
    {
      label: 'Now',
      cell: ({ state }) => (
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <StateBadge tone={state.tone} text={state.text} />
          {state.from !== undefined && (
            <span className="text-xs text-muted-foreground">
              from <span className="font-mono">{state.from}</span>
            </span>
          )}
        </span>
      ),
    },
    {
      label: 'Carried',
      cell: ({ status }) =>
        status === undefined || status.latest_handshake === 0 ? '–' : <Traffic down={status.tx_bytes} up={status.rx_bytes} />,
      className: 'text-xs text-muted-foreground',
    },
    {
      label: 'Open',
      hidden: true,
      cell: ({ peer }) => (
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Open ${peerLabel(peer)}`}
          onClick={(e) => {
            e.stopPropagation();
            onOpen(peer.section);
          }}
        >
          <QrCodeIcon />
          <ChevronRightIcon />
        </Button>
      ),
      className: 'py-1.5 text-right',
    },
  ];
}

/** The devices, in the config's order: a table on a wide screen, a list on a phone; a row opens its sheet. */
function Devices({
  rows,
  onOpen,
  onAdd,
}: {
  rows: readonly Row[];
  onOpen: (section: string) => void;
  onAdd: () => void;
}): ReactElement {
  const columns = useMemo(() => peerColumns(onOpen), [onOpen]);
  const add = (
    <Button variant="outline" size="sm" onClick={onAdd}>
      <PlusIcon />
      Add a device
    </Button>
  );
  return (
    <Card className="pb-0">
      <CardHeading
        title="Devices"
        description={
          rows.length === 0
            ? 'Each phone or laptop that connects, with keys of its own.'
            : 'Each with keys of its own. Open one for its QR code and config file.'
        }
        action={add}
      />
      <div className="border-t">
        <DataTable
          label="Devices"
          columns={columns}
          rows={rows}
          rowKey={(r) => r.peer.section}
          empty="No device is set up. Add one, save, then scan its QR code in the WireGuard app."
          framed={false}
          wide="md"
          rowProps={({ peer }) => ({
            onClick: () => {
              onOpen(peer.section);
            },
            className: cn('cursor-pointer', !peer.enabled && 'text-muted-foreground'),
          })}
          card={({ peer, status, state }) => (
            <button
              type="button"
              onClick={() => {
                onOpen(peer.section);
              }}
              className="flex w-full cursor-pointer items-center gap-3 px-5 py-3 text-left hover:bg-muted/60"
            >
              <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                <span className="flex min-w-0 items-baseline gap-2">
                  <span className="truncate text-sm font-medium">{peerLabel(peer)}</span>
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">{peer.ip}</span>
                </span>
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <StateBadge tone={state.tone} text={state.text} />
                  {status !== undefined && status.latest_handshake > 0 && <Traffic down={status.tx_bytes} up={status.rx_bytes} />}
                </span>
              </span>
              <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            </button>
          )}
        />
      </div>
    </Card>
  );
}

/** A device's config for its WireGuard app: QR code, the text, a download. */
function DeviceConfig({ peer, form, data }: { peer: PeerForm; form: ServerForm; data: ServerData }): ReactElement {
  const [everything, setEverything] = useState(true);
  const conf = peerConfig(peer, form, data, everything);
  const download = (): void => {
    if (conf === undefined) return;
    const url = URL.createObjectURL(new Blob([conf], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = confFileName(peer);
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        In the WireGuard app (App Store, Google Play, wireguard.com for computers): add a tunnel, then scan this code or import
        the file. It holds the device’s own key, so keep it to that device.
      </p>
      <Field
        id="conf-everything"
        label="Send all its traffic through home"
        hint={
          everything
            ? 'Safe on any Wi-Fi: everything goes through your connection.'
            : 'Only your home network goes through; the rest goes out where the device is.'
        }
      >
        <Switch id="conf-everything" checked={everything} onCheckedChange={setEverything} />
      </Field>
      {conf === undefined ? (
        <Note tone="warning" icon={<TriangleAlertIcon />}>
          {peer.privateKey === ''
            ? 'It was set up elsewhere with only its public key, so its config can’t be made here: its own device has it.'
            : 'There’s no address for devices to connect to yet: the internet port has none. Set one under “Address devices connect to”.'}
        </Note>
      ) : (
        <>
          <div className="flex justify-center">
            <QrCode
              text={conf}
              label={`QR code with the WireGuard config for ${peerLabel(peer)}`}
              className="size-64 max-w-full rounded-lg border"
            />
          </div>
          <pre className="overflow-x-auto rounded-lg border bg-muted p-3 font-mono text-xs leading-relaxed select-all">
            {conf}
          </pre>
          <Button variant="outline" className="self-start" onClick={download}>
            <DownloadIcon />
            Download {confFileName(peer)}
          </Button>
        </>
      )}
    </div>
  );
}

/** A device's sheet: its name, whether it may connect, and its config once saved. Edits go into the page's form, saved with the save bar. */
function DeviceSheet({
  peer,
  row,
  form,
  saved,
  data,
  canShow,
  errors,
  onChange,
  onRemove,
  onClose,
}: {
  peer: PeerForm;
  row: Row | undefined;
  form: ServerForm;
  saved: ServerForm;
  data: ServerData;
  canShow: boolean;
  errors: Errors;
  onChange: (p: PeerForm) => void;
  onRemove: () => void;
  onClose: () => void;
}): ReactElement {
  const at = `peer-${peer.section}`;
  const state = row?.state;
  const connect = (
    <section className={cn('flex flex-col gap-3', !canShow && 'border-t pt-4')} aria-labelledby={`${at}-conf`}>
      <h3 id={`${at}-conf`} className="text-sm font-semibold">
        Connect it
      </h3>
      {canShow ? (
        <DeviceConfig peer={peer} form={saved} data={data} />
      ) : (
        <Note tone="info" icon={<QrCodeIcon />}>
          {!saved.enabled && saved.peers.some((p) => p.section === peer.section)
            ? 'Its QR code and config file show here while Remote access is on.'
            : 'Save first: its QR code and config file show here once the settings are saved.'}
        </Note>
      )}
    </section>
  );
  return (
    <EditorSheet
      title={peerLabel(peer)}
      description={
        state === undefined ? undefined : (
          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
            {state.text}
            {state.from !== undefined && (
              <span className="text-xs">
                from <span className="font-mono">{state.from}</span>
              </span>
            )}
            {row?.status !== undefined && row.status.latest_handshake > 0 && (
              <Traffic down={row.status.tx_bytes} up={row.status.rx_bytes} />
            )}
          </span>
        )
      }
      status={
        <Button
          variant="ghost"
          className="text-destructive hover:bg-destructive-subtle hover:text-destructive"
          onClick={onRemove}
        >
          <Trash2Icon />
          Remove
        </Button>
      }
      actions={<Button onClick={onClose}>Done</Button>}
      onClose={onClose}
    >
      <div className="flex flex-col gap-6 px-6 py-4">
        {canShow && connect}
        <div className={cn('divide-y', canShow && 'border-t')}>
          <Field id={`${at}-name`} label="Name" hint="What this page calls it." error={errors[`${at}-name`]}>
            <Input
              id={`${at}-name`}
              value={peer.name}
              placeholder={peerLabel(peer)}
              maxLength={40}
              aria-invalid={errors[`${at}-name`] !== undefined}
              onChange={(e) => {
                onChange({ ...peer, name: e.target.value });
              }}
            />
          </Field>
          <Field id={`${at}-enabled`} label="May connect" hint="Off pauses it: its key stops working until you turn it back on.">
            <Switch
              id={`${at}-enabled`}
              checked={peer.enabled}
              onCheckedChange={(v) => {
                onChange({ ...peer, enabled: v });
              }}
            />
          </Field>
          <Field
            id={`${at}-ip`}
            label="Address in the tunnel"
            status={`In ${subnetOf(form.address, form.prefix)}.`}
            why={
              <>
                Its <span className="font-mono">allowed_ips</span> on peer <span className="font-mono">{peer.section}</span> of{' '}
                {SERVER}
                {peer.otherIps.length > 0 ? `, with ${peer.otherIps.join(', ')} kept as set in LuCI` : ''}.
              </>
            }
            error={errors[`${at}-ip`]}
          >
            {errors[`${at}-ip`] === undefined ? (
              <span className="py-2 font-mono text-sm">{peer.ip}</span>
            ) : (
              <Input
                id={`${at}-ip`}
                value={peer.ip}
                aria-invalid
                className="max-w-48 font-mono"
                onChange={(e) => {
                  onChange({ ...peer, ip: e.target.value.trim() });
                }}
              />
            )}
          </Field>
          {errors[`${at}-key`] !== undefined && (
            <p className="py-3 text-xs font-medium text-destructive">{errors[`${at}-key`]}</p>
          )}
        </div>
        {!canShow && connect}
      </div>
    </EditorSheet>
  );
}

function AddSheet({ onClose, onAdd }: { onClose: () => void; onAdd: (name: string) => Promise<void> }): ReactElement {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const add = async (): Promise<void> => {
    setBusy(true);
    setError(undefined);
    try {
      await onAdd(name.trim());
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <EditorSheet
      title="Add a device"
      description="Each phone or laptop gets keys of its own, made on the router, so one can be paused or removed without touching the others. After saving, its QR code shows."
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={name.trim() === '' || busy} onClick={() => void add()}>
            {busy && <LoaderCircleIcon className="animate-spin" />}
            Add
          </Button>
        </>
      }
      onClose={onClose}
    >
      <div className="px-6 py-2">
        <Field id="new-peer-name" label="Name" hint="What this page calls it, e.g. Sam’s phone." error={error}>
          <Input
            id="new-peer-name"
            value={name}
            maxLength={40}
            onChange={(e) => {
              setName(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && name.trim() !== '' && !busy) void add();
            }}
          />
        </Field>
      </div>
    </EditorSheet>
  );
}

/** Whether a device outside can reach the router, and what to do when it can't. */
function reachText(form: ServerForm, data: ServerData): { badge: ReactElement; text: ReactNode } {
  const reach = reachOf(data.wan);
  const host = endpointHost(form, data);
  switch (reach) {
    case 'public':
      return {
        badge: <Badge variant="success">Reachable</Badge>,
        text: (
          <>
            Devices connect to <span className="font-mono">{host === undefined ? data.wan.ipv4 : `${host}:${form.port}`}</span>,
            the router’s own public address
            {form.endpoint.trim() === '' ? '' : ' (by its name)'}. Nothing needs forwarding anywhere else.
          </>
        ),
      };
    case 'private':
      return {
        badge: <Badge variant="warning">Behind another router</Badge>,
        text: `On that router${data.wan.gateway === undefined ? '' : ` (${data.wan.gateway})`}, forward UDP port ${form.port} to ${data.wan.ipv4 ?? 'this router'}, or devices can’t connect from outside.`,
      };
    case 'shared':
      return {
        badge: <Badge variant="warning">Not reachable</Badge>,
        text: `Your provider shares one public address between customers (CGNAT: the internet port has ${data.wan.ipv4 ?? 'a shared address'}), so nothing outside can start a connection to this router. Ask your provider for a public IPv4 address${data.wan.ipv6 === undefined ? '' : `, or set the address devices connect to to this router’s IPv6 address (${data.wan.ipv6}) for devices that have IPv6`}.`,
      };
    case 'none':
      return { badge: <Badge variant="warning">No address</Badge>, text: 'The internet port has no IPv4 address right now.' };
  }
}

/** The answer: on or off, how many devices are connected, and whether the internet can reach the router. */
function Answer({
  form,
  saved,
  data,
  rows,
  running,
  onToggle,
}: {
  form: ServerForm;
  saved: ServerForm;
  data: ServerData;
  rows: readonly Row[];
  running: WgInterface | undefined;
  onToggle: (v: boolean) => void;
}): ReactElement {
  // the devices as saved: one added here and not saved yet doesn't count
  const known = rows.filter((r) => saved.peers.some((p) => p.section === r.peer.section));
  const connected = known.filter((r) => r.state.tone === 'connected').length;
  const on = saved.enabled && data.exists;
  const reach = reachText(saved, data);
  const allowed = [
    saved.internet && 'the internet through home',
    saved.lan && 'your home network',
    saved.admin && 'this router’s settings',
    saved.between && 'each other',
  ].filter((x) => x !== false);
  return (
    <Card className="gap-0 py-0">
      <div className="flex flex-col gap-1.5 p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="text-lg font-semibold tracking-tight">
              {!on
                ? data.exists
                  ? 'No port is open'
                  : 'Not set up yet'
                : known.length === 0
                  ? 'No devices yet'
                  : connected === 0
                    ? `No device connected now, ${String(known.length)} set up`
                    : `${String(connected)} of ${String(known.length)} ${known.length === 1 ? 'device' : 'devices'} connected`}
            </h2>
            {/* the heading already says when it isn't set up */}
            {data.exists && (on ? <Badge variant="success">On</Badge> : <Badge variant="secondary">Off</Badge>)}
          </div>
          <Switch
            checked={form.enabled}
            onCheckedChange={(v) => {
              onToggle(v);
            }}
            aria-label="Remote access on"
          />
        </div>
        <p className="max-w-prose text-sm text-muted-foreground">
          {on
            ? `WireGuard answers at UDP port ${saved.port}${running === undefined ? ', once its interface is up' : ''}.`
            : data.exists
              ? 'No device can connect. Turn it on to open its port again; the devices keep their keys.'
              : 'Turn it on, add a phone or a laptop, save, then scan its QR code in the WireGuard app.'}
        </p>
      </div>
      {on && (
        <div className="grid divide-y border-t md:grid-cols-2 md:divide-x md:divide-y-0">
          <Cell title="From outside" status={reach.badge}>
            <p>{reach.text}</p>
          </Cell>
          <Cell
            title="Devices can reach"
            status={
              <span className="text-sm font-medium">
                {allowed.length === 0 ? 'Only DNS on the router' : `${String(allowed.length)} of 4`}
              </span>
            }
          >
            <p>
              {allowed.length === 0
                ? 'Nothing else: each switch under Settings is off.'
                : `${allowed.join(', ').replace(/^./, (c) => c.toUpperCase())}.`}
            </p>
          </Cell>
        </div>
      )}
    </Card>
  );
}

export function RemoteAccessPage(): ReactElement {
  return (
    <>
      <PageHeader
        title="Remote access"
        description="Reach home from anywhere: phones and laptops connect to this router with WireGuard."
      />
      <PageBoundary>
        <RemoteAccess />
      </PageBoundary>
    </>
  );
}

function RemoteAccess(): ReactElement {
  const { data } = useSuspenseQuery(remoteAccessQueries.settings());
  // a static IP from the provider doesn't change; DHCP and PPPoE addresses can
  const fixedAddress = data.wan.proto === 'static';
  const [open, setOpen] = useState<string>();
  const [adding, setAdding] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [keyError, setKeyError] = useState<string>();
  const showAfter = useRef<string | undefined>(undefined);
  const renew = useRef(false);
  const { mutateAsync: makeKeys } = useNewKeys();
  const { mutate: renewServer } = useRenewServer();
  const onApplied = useCallback(() => {
    // a device added and saved: its sheet opens on its QR code
    if (showAfter.current !== undefined) setOpen(showAfter.current);
    showAfter.current = undefined;
    // devices added, changed or removed on a server that was already up
    if (renew.current) renewServer();
    renew.current = false;
  }, [renewServer]);
  const { state, apply } = useApply(onApplied);
  const status = useLive(remoteAccessQueries.status()).data;

  const saved = data.form;
  const schema = useMemo(() => serverFormSchema(data), [data]);
  const settings = useSettingsForm({
    schema,
    saved,
    onSave: async (values) => {
      await save(values);
    },
  });
  const { form: formApi } = settings;
  const form = useFormValues(formApi);
  const dirty = settings.dirty;
  // errors once a change or a save has checked the form
  const errors = dirty || settings.invalid ? serverErrors(form, data) : {};
  const invalid = Object.keys(errors).length > 0;
  const fix = dirty ? [] : drift(data);
  const running = status?.interfaces.find((i) => i.name === SERVER);
  // the router's clock, which the handshakes are on
  const now = status?.now ?? 0;

  // several fields at once (a first device turns it on): each one that changes, as typed
  const update = (next: ServerForm): void => {
    for (const key of serverFormKeys) if (!evaluate(form[key], next[key])) formApi.setFieldValue(key, next[key]);
  };
  const set = <K extends keyof ServerForm>(key: K, value: ServerForm[K]): void => {
    update({ ...form, [key]: value });
  };
  const savedPeer = (p: PeerForm): boolean => saved.peers.some((s) => evaluate(s, p));

  const save = async (values: ServerForm): Promise<void> => {
    let f = values;
    setKeyError(undefined);
    // the server's own key, made the first time there's something to save
    if (f.privateKey === '' && (f.enabled || f.peers.length > 0)) {
      try {
        f = { ...f, privateKey: (await makeKeys()).privateKey };
      } catch (err) {
        setKeyError(errorMessage(err));
        return;
      }
    }
    const applied = summary(data.exists ? data.form : undefined, f);
    showAfter.current = f.enabled
      ? f.peers.find((p) => !data.form.peers.some((s) => s.section === p.section))?.section
      : undefined;
    const changes = toChanges(f, data);
    const peers = new Set([...f.peers, ...data.form.peers].map((p) => p.section));
    renew.current =
      f.enabled &&
      changes.some(
        (c) => c.config === 'network' && ('section' in c ? peers.has(c.section) : c.op === 'add' && c.type === PEER_TYPE),
      );
    await apply(changes, { note: applied.join(' ') });
  };

  const addPeer = async (name: string): Promise<void> => {
    const ip = nextPeerIp(form);
    if (ip === undefined) throw new Error('The tunnel’s network has no address left.');
    const keys = await makeKeys();
    const peer: PeerForm = {
      section: newPeerSection(form, data),
      name,
      ip,
      otherIps: [],
      enabled: true,
      publicKey: keys.publicKey,
      privateKey: keys.privateKey,
      presharedKey: keys.presharedKey,
    };
    // a first device turns it on: that's what it's for
    update({ ...form, enabled: form.enabled || (!data.exists && form.peers.length === 0), peers: [...form.peers, peer] });
  };

  const rows: Row[] = form.peers.map((p) => {
    const st = running?.peers.find((x) => x.public_key === p.publicKey);
    // added here and not saved yet: nothing to say about it
    if (!saved.peers.some((x) => x.section === p.section))
      return { peer: p, status: undefined, state: { tone: 'never', text: 'Not saved yet' } };
    return { peer: p, status: st, state: peerState(p, st, now, running !== undefined) };
  });
  const openPeer = form.peers.find((p) => p.section === open);

  return (
    <>
      <div className="flex flex-col gap-4">
        <ApplyStatus state={state} />
        {keyError !== undefined && (
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertTitle>Couldn’t save</AlertTitle>
            <AlertDescription>{keyError}</AlertDescription>
          </Alert>
        )}
        {!data.installed ? (
          <NoWireGuard />
        ) : (
          <>
            <Answer
              form={form}
              saved={saved}
              data={data}
              rows={rows}
              running={running}
              onToggle={(v) => {
                set('enabled', v);
              }}
            />
            {fix.length > 0 && (
              <Alert variant="warning">
                <TriangleAlertIcon />
                <AlertTitle>Changed outside this page</AlertTitle>
                <AlertDescription>
                  Some of its parts were edited in LuCI or on the Firewall page (
                  {[...new Set(fix.map((c) => ('section' in c ? c.section : c.config)))].join(', ')}). Saving here puts them back
                  as this page sets them.
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2"
                    disabled={state.phase === 'applying'}
                    onClick={() => {
                      void apply(fix, { note: 'Put its parts back as this page sets them.' });
                    }}
                  >
                    <Undo2Icon />
                    Put back
                  </Button>
                </AlertDescription>
              </Alert>
            )}
            <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
              <div className="flex min-w-0 flex-col gap-4">
                <Devices
                  rows={rows}
                  onOpen={setOpen}
                  onAdd={() => {
                    setAdding(true);
                  }}
                />
                <Card>
                  <CardHeading
                    title="Settings"
                    description="Where devices find the router, and what they may reach once connected."
                  />
                  <CardContent className="flex flex-col">
                    <div className="divide-y border-t">
                      <Field
                        id="endpoint"
                        label="Address devices connect to"
                        {...explain(
                          `Empty: this router’s internet address${data.wan.ipv4 === undefined ? '' : ` (${data.wan.ipv4})`}. It goes into each device’s config (its file or QR code), so it’s the address devices dial. ${
                            fixedAddress
                              ? 'Your provider gives this router a fixed address, so devices can rely on it.'
                              : 'Your provider hands this address out and can change it, and devices then stop connecting until they get a new config: until MilkFlint has dynamic DNS (below), remote access is dependable with a static IP from your provider, or a hostname you keep up to date yourself.'
                          } OpenWrt has no option for this, so MilkFlint saves it in its own settings.`,
                          ['milkflint.remote_access.endpoint'],
                        )}
                        error={errors['endpoint']}
                      >
                        <Input
                          id="endpoint"
                          value={form.endpoint}
                          placeholder={data.wan.ipv4 ?? 'home.example.com'}
                          aria-invalid={errors['endpoint'] !== undefined}
                          onChange={(e) => {
                            set('endpoint', e.target.value);
                          }}
                        />
                      </Field>
                      {/* not built yet: said here so the address above is chosen knowing it */}
                      <div className="@container">
                        <div className="grid gap-2 py-3.5 @min-[40rem]:grid-cols-[minmax(10rem,15rem)_minmax(0,1fr)] @min-[40rem]:gap-8">
                          <p className="flex flex-wrap items-center gap-2 text-sm font-medium @min-[40rem]:pt-2">
                            Dynamic DNS
                            <Badge variant="outline">Coming soon</Badge>
                          </p>
                          <p className="max-w-prose text-sm text-muted-foreground @min-[40rem]:pt-2">
                            Will keep a hostname pointing at your internet address, so devices still find home after your provider
                            changes it.{' '}
                            {fixedAddress
                              ? 'Your address is fixed, so you don’t need it.'
                              : 'Until then, remote access is dependable with a static IP from your provider.'}
                          </p>
                        </div>
                      </div>
                      {(
                        [
                          [
                            'internet',
                            'Internet through home',
                            'For devices whose config sends all their traffic home: safe browsing on any Wi-Fi.',
                            `the forwarding ${SERVER}_wan`,
                          ],
                          [
                            'lan',
                            'Your home network',
                            'Devices, printers and drives at home, as if the device were there.',
                            `the forwarding ${SERVER}_lan`,
                          ],
                          [
                            'admin',
                            'This router’s settings',
                            'These pages, LuCI and SSH, from anywhere. Off, devices still get DNS from it.',
                            `zone ${SERVER}’s input policy`,
                          ],
                          [
                            'between',
                            'Each other',
                            'Devices connected this way reach one another.',
                            `zone ${SERVER}’s forward policy`,
                          ],
                        ] as const
                      ).map(([key, label, hint, option]) => (
                        <Field key={key} id={`access-${key}`} label={label} hint={hint} why={<>In the firewall: {option}.</>}>
                          <Switch
                            id={`access-${key}`}
                            checked={form[key]}
                            onCheckedChange={(v) => {
                              set(key, v);
                            }}
                          />
                        </Field>
                      ))}
                    </div>
                    <MoreSettings
                      summary={
                        errors['port'] !== undefined || errors['address'] !== undefined
                          ? 'Something to fix here'
                          : `UDP ${form.port}, tunnel ${subnetOf(form.address, form.prefix)}`
                      }
                    >
                      <Field
                        id="port"
                        label="Port"
                        hint="UDP. Devices’ configs carry it."
                        why={
                          <>
                            Changing it means giving each device its config again. It’s{' '}
                            <span className="font-mono">listen_port</span> on interface {SERVER}, and the rule{' '}
                            <span className="font-mono">{SERVER}_port</span> that opens it.
                          </>
                        }
                        error={errors['port']}
                      >
                        <Input
                          id="port"
                          inputMode="numeric"
                          value={form.port}
                          className="max-w-32 tabular"
                          aria-invalid={errors['port'] !== undefined}
                          onChange={(e) => {
                            set('port', e.target.value.trim());
                          }}
                        />
                      </Field>
                      <Field
                        id="address"
                        label="Tunnel address"
                        hint={`The router’s address inside the tunnel; devices get others in ${subnetOf(form.address, form.prefix) === '' ? 'its network' : subnetOf(form.address, form.prefix)}.`}
                        why={
                          <>
                            Changing it renumbers the devices, and each needs its config again. It’s{' '}
                            <span className="font-mono">addresses</span> on interface {SERVER}.
                          </>
                        }
                        error={errors['address']}
                      >
                        <Input
                          id="address"
                          value={form.address}
                          className="max-w-48 font-mono"
                          aria-invalid={errors['address'] !== undefined}
                          onChange={(e) => {
                            update(moveTo(form, e.target.value.trim()));
                          }}
                        />
                      </Field>
                    </MoreSettings>
                  </CardContent>
                </Card>
              </div>

              <div className="flex flex-col gap-4">
                <Card>
                  <CardHeading title="What this sets up" status={dirty ? 'Once saved.' : 'As saved.'} />
                  <CardContent className="flex flex-col gap-4">
                    <ul className="flex flex-col gap-2">
                      {describe(form, data).map((l) => (
                        <CheckItem key={l.text} yes={l.ok}>
                          {l.text}
                        </CheckItem>
                      ))}
                    </ul>
                    <p className="border-t pt-3 text-xs text-muted-foreground">
                      It’s OpenWrt’s own WireGuard setup, so LuCI shows it too: Network → Interfaces ({SERVER}, with a peer per
                      device) and Network → Firewall. On the{' '}
                      <Link {...pageLink('firewall', 'zones')} className="font-medium link underline-offset-4">
                        Firewall page
                      </Link>{' '}
                      it’s zone {SERVER}; DNS follows the{' '}
                      <Link {...pageLink('dns')} className="font-medium link underline-offset-4">
                        DNS page
                      </Link>
                      .
                    </p>
                  </CardContent>
                </Card>
                {data.exists && (
                  <Button
                    variant="ghost"
                    className="self-start text-destructive hover:bg-destructive-subtle hover:text-destructive"
                    disabled={state.phase === 'applying'}
                    onClick={() => {
                      setConfirmRemove(true);
                    }}
                  >
                    <Trash2Icon />
                    Remove remote access
                  </Button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
      <SaveBar
        visible={dirty}
        busy={state.phase === 'applying'}
        invalid={invalid}
        onSave={settings.save}
        onRevert={settings.discard}
      />
      {openPeer !== undefined && (
        <DeviceSheet
          key={openPeer.section}
          peer={openPeer}
          row={rows.find((r) => r.peer.section === openPeer.section)}
          form={form}
          saved={saved}
          data={data}
          canShow={!dirty && savedPeer(openPeer) && data.form.enabled}
          errors={errors}
          onChange={(np) => {
            set(
              'peers',
              form.peers.map((x) => (x.section === openPeer.section ? np : x)),
            );
          }}
          onRemove={() => {
            set(
              'peers',
              form.peers.filter((x) => x.section !== openPeer.section),
            );
            setOpen(undefined);
          }}
          onClose={() => {
            setOpen(undefined);
          }}
        />
      )}
      {adding && (
        <AddSheet
          onClose={() => {
            setAdding(false);
          }}
          onAdd={addPeer}
        />
      )}
      <Dialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove remote access?</DialogTitle>
            <DialogDescription>
              The WireGuard interface, every device’s keys, its firewall zone and rules all go, here and in LuCI, and every
              device’s config stops working. To only pause it, turn it off instead.
              {dirty ? ' Changes you haven’t saved are dropped too.' : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setConfirmRemove(false);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmRemove(false);
                settings.discard();
                void apply(removal(data), {
                  note: `${data.form.enabled ? `Closed UDP port ${data.form.port}.` : 'Nothing was open.'} Deleted the WireGuard interface, its devices and its firewall zone and rules.`,
                });
              }}
            >
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
