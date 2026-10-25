import {
  DownloadIcon,
  GlobeIcon,
  LoaderCircleIcon,
  PlusIcon,
  QrCodeIcon,
  ShieldCheckIcon,
  SmartphoneIcon,
  Trash2Icon,
  TriangleAlertIcon,
  Undo2Icon,
} from 'lucide-react';
import { type ReactElement, useCallback, useRef, useState } from 'react';
import { ApplyStatus } from '@/components/apply-status';
import { CardHeading } from '@/components/card-heading';
import { Field } from '@/components/field';
import { PageHeader } from '@/components/layout/page-header';
import { FormSkeleton, LoadError } from '@/components/page-states';
import { QrCode } from '@/components/qr-code';
import { SaveBar } from '@/components/save-bar';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { useApply } from '@/hooks/use-apply';
import { useLoad } from '@/hooks/use-load';
import { usePoll } from '@/hooks/use-poll';
import { getWgStatus, isConnected, newKeys, renewInterface, type WgPeer } from '@/lib/api/wireguard';
import { formatBytes, formatDuration } from '@/lib/format';
import { href } from '@/lib/router';
import { errorMessage } from '@/lib/utils';
import { loadServer } from './api';
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
  summary,
  toChanges,
  validate,
} from './model';
import { AppliedCard, CheckItem, NoWireGuard } from './parts';
import { PEER_TYPE, SERVER } from './sections';

/** "Connected, from 82.1.2.3", "Last seen 3h 5m ago", "Never connected". */
function peerState(peer: WgPeer | undefined, now: number, running: boolean): string {
  if (!running) return 'Remote access is off.';
  if (peer === undefined) return 'Paused.';
  if (peer.latest_handshake === 0) return 'Never connected yet.';
  const from = peer.endpoint === null ? '' : `, from ${peer.endpoint.replace(/:\d+$/, '').replace(/^\[|\]$/g, '')}`;
  const data = ` · ↓ ${formatBytes(peer.tx_bytes)} ↑ ${formatBytes(peer.rx_bytes)}`;
  if (isConnected(peer, now)) return `Connected${from}${data}`;
  return `Last connected ${formatDuration(now - peer.latest_handshake)} ago${data}`;
}

function DeviceRow({
  peer,
  status,
  now,
  running,
  canShow,
  errors,
  onChange,
  onRemove,
  onShow,
}: {
  peer: PeerForm;
  status: WgPeer | undefined;
  now: number;
  running: boolean;
  /** saved as it is, with the server on: its config would work */
  canShow: boolean;
  errors: Errors;
  onChange: (p: PeerForm) => void;
  onRemove: () => void;
  onShow: () => void;
}): ReactElement {
  const at = `peer-${peer.section}`;
  const connected = isConnected(status, now);
  return (
    <div className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0">
      <div className="flex items-center gap-2">
        <span className={connected ? 'size-2 shrink-0 rounded-full bg-success' : 'size-2 shrink-0 rounded-full bg-muted-foreground/40'} />
        <Input
          id={`${at}-name`}
          value={peer.name}
          placeholder={peerLabel(peer)}
          maxLength={40}
          aria-label="Device name"
          aria-invalid={errors[`${at}-name`] !== undefined}
          className="h-8 max-w-56"
          onChange={(e) => {
            onChange({ ...peer, name: e.target.value });
          }}
        />
        <span className="hidden font-mono text-xs text-muted-foreground sm:inline">{peer.ip}</span>
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Show ${peerLabel(peer)}’s QR code`}
            title={canShow ? 'QR code and config' : 'Save first: its config needs the settings saved'}
            disabled={!canShow}
            onClick={onShow}
          >
            <QrCodeIcon />
          </Button>
          <Switch
            checked={peer.enabled}
            aria-label={`${peerLabel(peer)} may connect`}
            onCheckedChange={(v) => {
              onChange({ ...peer, enabled: v });
            }}
          />
          <Button variant="ghost" size="icon" aria-label={`Remove ${peerLabel(peer)}`} className="text-destructive hover:text-destructive" onClick={onRemove}>
            <Trash2Icon />
          </Button>
        </div>
      </div>
      <p className="pl-4 text-xs text-muted-foreground tabular">{peerState(peer.enabled ? status : undefined, now, running)}</p>
      {errors[`${at}-ip`] !== undefined && (
        <div className="flex items-center gap-2 pl-4">
          <Input
            value={peer.ip}
            aria-label="Its address in the tunnel"
            aria-invalid
            className="h-8 max-w-40 font-mono"
            onChange={(e) => {
              onChange({ ...peer, ip: e.target.value.trim() });
            }}
          />
          <span className="text-xs text-destructive">{errors[`${at}-ip`]}</span>
        </div>
      )}
      {[errors[`${at}-name`], errors[`${at}-key`]].map((m) =>
        m === undefined ? null : (
          <p key={m} className="pl-4 text-xs text-destructive">
            {m}
          </p>
        ),
      )}
    </div>
  );
}

function ConfigDialog({ peer, form, data, onClose }: { peer: PeerForm | undefined; form: ServerForm; data: ServerData; onClose: () => void }): ReactElement {
  const [everything, setEverything] = useState(true);
  const conf = peer === undefined ? undefined : peerConfig(peer, form, data, everything);
  const download = (): void => {
    if (conf === undefined || peer === undefined) return;
    const url = URL.createObjectURL(new Blob([conf], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = confFileName(peer);
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <Dialog
      open={peer !== undefined}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Connect {peer === undefined ? 'a device' : peerLabel(peer)}</DialogTitle>
          <DialogDescription>
            In the WireGuard app (App Store, Google Play, wireguard.com for computers): add a tunnel, then scan this code or import the file. It holds the device’s own
            key, so keep it to that device.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-between gap-4 rounded-lg border px-3 py-2.5">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium">Send all its traffic through home</span>
            <span className="text-xs text-muted-foreground">
              {everything
                ? 'Everything goes through your connection, safe on any Wi-Fi.'
                : 'Only your home network goes through; the rest goes out where the device is.'}
            </span>
          </div>
          <Switch checked={everything} onCheckedChange={setEverything} aria-label="Send all its traffic through home" />
        </div>
        {conf === undefined ? (
          <Alert variant="warning">
            <TriangleAlertIcon />
            <AlertDescription>
              {peer?.privateKey === ''
                ? 'It was set up elsewhere with only its public key, so its config can’t be made here: its own device has it.'
                : 'There’s no address for devices to connect to yet: the internet port has none. Set one under “Address devices connect to”.'}
            </AlertDescription>
          </Alert>
        ) : (
          <>
            <div className="flex justify-center">
              <QrCode text={conf} label={`QR code with the WireGuard config for ${peer === undefined ? 'the device' : peerLabel(peer)}`} className="size-72 rounded-lg border bg-white p-1" />
            </div>
            <pre className="overflow-x-auto rounded-lg border bg-muted/40 p-3 font-mono text-[11px] leading-relaxed select-all">{conf}</pre>
          </>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Done
          </Button>
          <Button variant="outline" disabled={conf === undefined} onClick={download}>
            <DownloadIcon />
            Download {peer === undefined ? '' : confFileName(peer)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddDialog({ open, onClose, onAdd }: { open: boolean; onClose: () => void; onAdd: (name: string) => Promise<void> }): ReactElement {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const add = async (): Promise<void> => {
    setBusy(true);
    setError(undefined);
    try {
      await onAdd(name.trim());
      setName('');
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a device</DialogTitle>
          <DialogDescription>
            Each phone or laptop gets keys of its own, made on the router, so one can be paused or removed without touching the others. After saving, its QR code shows.
          </DialogDescription>
        </DialogHeader>
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
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={name.trim() === '' || busy} onClick={() => void add()}>
            {busy && <LoaderCircleIcon className="animate-spin" />}
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Reaching({ form, data }: { form: ServerForm; data: ServerData }): ReactElement {
  const reach = reachOf(data.wan);
  const host = endpointHost(form, data);
  const set = form.endpoint.trim() !== '';
  return (
    <Card>
      <CardHeading icon={GlobeIcon} title="Reaching it from outside" />
      <CardContent className="flex flex-col gap-2 text-sm">
        {reach === 'public' && (
          <p>
            The router has a public address of its own ({data.wan.ipv4}), so devices reach it directly{set && host !== undefined ? ` at ${host}` : ''}. Nothing needs forwarding
            anywhere else.
          </p>
        )}
        {reach === 'private' && (
          <p className="text-warning">
            The router is behind another router{data.wan.gateway === undefined ? '' : ` (${data.wan.gateway})`}: on that one, forward UDP port {form.port} to{' '}
            {data.wan.ipv4}, or devices can’t connect from outside.
          </p>
        )}
        {reach === 'shared' && (
          <p className="text-warning">
            Your provider shares one public address between customers (CGNAT: the internet port has {data.wan.ipv4}), so nothing outside can start a connection to this
            router. Ask your provider for a public IPv4 address
            {data.wan.ipv6 === undefined ? '' : `, or set the address devices connect to to this router’s IPv6 address (${data.wan.ipv6}) for devices that have IPv6`}.
          </p>
        )}
        {reach === 'none' && <p className="text-warning">The internet port has no IPv4 address right now.</p>}
        {!set && reach === 'public' && (
          <p className="text-xs text-muted-foreground">
            Devices’ configs carry this address. If your provider changes it, they need new ones: a hostname that follows it (dynamic DNS) under “Address devices connect
            to” avoids that.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function RemoteAccessPage(): ReactElement {
  const { data, error, loading, reload } = useLoad(loadServer);
  const [edit, setEdit] = useState<ServerForm>();
  const [applied, setApplied] = useState<string[]>();
  const [qrFor, setQrFor] = useState<string>();
  const [adding, setAdding] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [keyError, setKeyError] = useState<string>();
  const showAfter = useRef<string | undefined>(undefined);
  const renew = useRef(false);
  const onApplied = useCallback(() => {
    setEdit(undefined);
    setQrFor(showAfter.current);
    showAfter.current = undefined;
    // devices added, changed or removed on a server that was already up
    if (renew.current) void renewInterface(SERVER).catch(() => undefined).finally(reload);
    else reload();
    renew.current = false;
  }, [reload]);
  const { state, apply } = useApply(onApplied);
  const status = usePoll(getWgStatus, 5000).data;

  const saved = data?.form;
  const form = edit ?? saved;
  const errors = form === undefined || data === undefined ? {} : validate(form, data);
  const dirty = edit !== undefined && JSON.stringify(edit) !== JSON.stringify(saved);
  const invalid = Object.keys(errors).length > 0;
  const fix = data === undefined || dirty ? [] : drift(data);
  const running = status?.interfaces.find((i) => i.name === SERVER);
  // the router's clock, which the handshakes are on
  const now = status?.now ?? 0;

  const set = <K extends keyof ServerForm>(key: K, value: ServerForm[K]): void => {
    if (form !== undefined) setEdit({ ...form, [key]: value });
  };
  const savedPeer = (p: PeerForm): boolean => saved?.peers.some((s) => JSON.stringify(s) === JSON.stringify(p)) === true;

  const save = async (): Promise<void> => {
    if (data === undefined || form === undefined) return;
    let f = form;
    setKeyError(undefined);
    // the server's own key, made the first time there's something to save
    if (f.privateKey === '' && (f.enabled || f.peers.length > 0)) {
      try {
        f = { ...f, privateKey: (await newKeys()).privateKey };
      } catch (err) {
        setKeyError(errorMessage(err));
        return;
      }
    }
    setApplied(summary(data.exists ? data.form : undefined, f));
    showAfter.current = f.enabled ? f.peers.find((p) => !data.form.peers.some((s) => s.section === p.section))?.section : undefined;
    const changes = toChanges(f, data);
    const peers = new Set([...f.peers, ...data.form.peers].map((p) => p.section));
    renew.current = f.enabled && changes.some((c) => c.config === 'network' && ('section' in c ? peers.has(c.section) : c.op === 'add' && c.type === PEER_TYPE));
    await apply(changes);
  };

  const addPeer = async (name: string): Promise<void> => {
    if (data === undefined || form === undefined) return;
    const ip = nextPeerIp(form);
    if (ip === undefined) throw new Error('The tunnel’s network has no address left.');
    const keys = await newKeys();
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
    setEdit({ ...form, enabled: form.enabled || (!data.exists && form.peers.length === 0), peers: [...form.peers, peer] });
  };

  const qrPeer = form?.peers.find((p) => p.section === qrFor);
  const description = 'Reach home from anywhere: phones and laptops connect to this router with WireGuard.';

  return (
    <>
      <PageHeader title="Remote access" description={description} />
      <div className="flex flex-col gap-4">
        <ApplyStatus state={state} />
        {state.phase === 'done' && !state.nothingChanged && applied !== undefined && <AppliedCard lines={applied} />}
        {keyError !== undefined && (
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertTitle>Couldn’t save</AlertTitle>
            <AlertDescription>{keyError}</AlertDescription>
          </Alert>
        )}
        {error !== undefined && data === undefined ? (
          <LoadError error={error} retry={reload} />
        ) : loading || data === undefined || form === undefined ? (
          <FormSkeleton />
        ) : !data.installed ? (
          <NoWireGuard />
        ) : (
          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
            <div className="flex flex-col gap-4">
              <Card>
                <CardHeader className="items-center">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <SmartphoneIcon className="size-4" />
                  </div>
                  <div className="flex min-w-0 flex-col gap-1">
                    <CardTitle className="text-base">WireGuard server</CardTitle>
                    <CardDescription>
                      {form.enabled ? `On, at UDP port ${form.port}` : data.exists ? 'Off: no port is open' : 'Not set up yet'}
                      {running !== undefined && form.enabled ? ` · ${String(running.peers.filter((p) => isConnected(p, now)).length)} connected` : ''}
                    </CardDescription>
                  </div>
                  <CardAction>
                    <Switch
                      checked={form.enabled}
                      onCheckedChange={(v) => {
                        set('enabled', v);
                      }}
                      aria-label="Remote access on"
                    />
                  </CardAction>
                </CardHeader>
                <CardContent>
                  <Separator />
                  <div className="divide-y">
                    <Field
                      id="endpoint"
                      label="Address devices connect to"
                      hint={`Empty: this router’s internet address${data.wan.ipv4 === undefined ? '' : ` (${data.wan.ipv4})`}. A hostname that follows it (dynamic DNS) keeps devices working when your provider changes it.`}
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
                    <Field id="port" label="Port" hint="UDP. Devices’ configs carry it, so changing it means giving each its config again." error={errors['port']}>
                      <Input
                        id="port"
                        inputMode="numeric"
                        value={form.port}
                        className="max-w-32 font-mono"
                        aria-invalid={errors['port'] !== undefined}
                        onChange={(e) => {
                          set('port', e.target.value.trim());
                        }}
                      />
                    </Field>
                    <Field
                      id="address"
                      label="Tunnel address"
                      hint={`The router’s address inside the tunnel; devices get others in ${subnetOf(form.address, form.prefix) === '' ? 'its network' : subnetOf(form.address, form.prefix)}. Changing it renumbers them, and each needs its config again.`}
                      error={errors['address']}
                    >
                      <Input
                        id="address"
                        value={form.address}
                        className="max-w-48 font-mono"
                        aria-invalid={errors['address'] !== undefined}
                        onChange={(e) => {
                          setEdit(moveTo(form, e.target.value.trim()));
                        }}
                      />
                    </Field>
                    {(
                      [
                        ['internet', 'Internet through home', 'For devices whose config sends all their traffic home: safe browsing on any Wi-Fi.'],
                        ['lan', 'Your home network', 'Devices, printers and drives at home, as if the device were there.'],
                        ['admin', 'This router’s settings', 'These pages, LuCI and SSH, from anywhere. Off, devices still get DNS from it.'],
                        ['between', 'Each other', 'Devices connected this way reach one another.'],
                      ] as const
                    ).map(([key, label, hint]) => (
                      <Field key={key} id={`access-${key}`} label={label} hint={hint}>
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
                </CardContent>
              </Card>

              <Card>
                <CardHeading
                  icon={SmartphoneIcon}
                  title="Devices"
                  description={form.peers.length === 0 ? 'None yet: add each phone or laptop that should connect.' : `${String(form.peers.length)} set up`}
                  action={
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setAdding(true);
                      }}
                    >
                      <PlusIcon />
                      Add a device
                    </Button>
                  }
                />
                {form.peers.length > 0 && (
                  <CardContent className="flex flex-col divide-y">
                    {form.peers.map((p) => (
                      <DeviceRow
                        key={p.section}
                        peer={p}
                        status={running?.peers.find((x) => x.public_key === p.publicKey)}
                        now={now}
                        running={running !== undefined}
                        canShow={!dirty && savedPeer(p) && data.form.enabled}
                        errors={errors}
                        onChange={(np) => {
                          set(
                            'peers',
                            form.peers.map((x) => (x.section === p.section ? np : x)),
                          );
                        }}
                        onRemove={() => {
                          set(
                            'peers',
                            form.peers.filter((x) => x.section !== p.section),
                          );
                        }}
                        onShow={() => {
                          setQrFor(p.section);
                        }}
                      />
                    ))}
                  </CardContent>
                )}
              </Card>
            </div>

            <div className="flex flex-col gap-4">
              {fix.length > 0 && (
                <Alert variant="warning">
                  <TriangleAlertIcon />
                  <AlertTitle>Changed outside this page</AlertTitle>
                  <AlertDescription>
                    Some of its parts were edited in LuCI or on the Firewall page ({[...new Set(fix.map((c) => ('section' in c ? c.section : c.config)))].join(', ')}). Saving
                    here puts them back as this page sets them.
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-2"
                      disabled={state.phase === 'applying'}
                      onClick={() => {
                        setApplied(['Put its parts back as this page sets them.']);
                        void apply(fix);
                      }}
                    >
                      <Undo2Icon />
                      Put back
                    </Button>
                  </AlertDescription>
                </Alert>
              )}
              <Card>
                <CardHeading icon={ShieldCheckIcon} title="What this sets up" description={dirty ? 'Once saved.' : undefined} />
                <CardContent className="flex flex-col gap-4">
                  <ul className="flex flex-col gap-2">
                    {describe(form, data).map((l) => (
                      <CheckItem key={l.text} yes={l.ok}>
                        {l.text}
                      </CheckItem>
                    ))}
                  </ul>
                  <p className="text-xs text-muted-foreground">
                    It’s OpenWrt’s own WireGuard setup, so LuCI shows it too: Network → Interfaces ({SERVER}, with a peer per device) and Network → Firewall. On the{' '}
                    <a href={`${href('firewall')}/zones`} className="underline">
                      Firewall page
                    </a>{' '}
                    it’s zone {SERVER}; DNS follows the{' '}
                    <a href={href('dns')} className="underline">
                      DNS page
                    </a>
                    .
                  </p>
                </CardContent>
              </Card>
              {form.enabled && <Reaching form={form} data={data} />}
              {data.exists && (
                <Button
                  variant="ghost"
                  className="self-start text-destructive hover:bg-destructive/10 hover:text-destructive"
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
        )}
      </div>
      <SaveBar
        visible={dirty}
        busy={state.phase === 'applying'}
        invalid={invalid}
        onSave={() => {
          void save();
        }}
        onRevert={() => {
          setEdit(undefined);
        }}
      />
      {data !== undefined && saved !== undefined && (
        <ConfigDialog
          peer={qrPeer}
          form={saved}
          data={data}
          onClose={() => {
            setQrFor(undefined);
          }}
        />
      )}
      <AddDialog
        open={adding}
        onClose={() => {
          setAdding(false);
        }}
        onAdd={addPeer}
      />
      <Dialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove remote access?</DialogTitle>
            <DialogDescription>
              The WireGuard interface, every device’s keys, its firewall zone and rules all go, here and in LuCI, and every device’s config stops working. To only pause
              it, turn it off instead.{dirty ? ' Changes you haven’t saved are dropped too.' : ''}
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
                if (data === undefined) return;
                setEdit(undefined);
                setApplied([
                  data.form.enabled ? `Closed UDP port ${data.form.port}.` : 'Nothing was open.',
                  'Deleted the WireGuard interface, its devices and its firewall zone and rules.',
                ]);
                void apply(removal(data));
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
