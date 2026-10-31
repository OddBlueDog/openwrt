import type { LucideIcon } from 'lucide-react';
import {
  ArrowRightIcon,
  CableIcon,
  CheckCircle2Icon,
  GlobeIcon,
  LaptopIcon,
  LoaderCircleIcon,
  NetworkIcon,
  RadioTowerIcon,
  RouterIcon,
  ServerOffIcon,
  ToggleLeftIcon,
  TriangleAlertIcon,
  Undo2Icon,
  WifiIcon,
  ZapIcon,
} from 'lucide-react';
import { type ReactElement, type ReactNode, useCallback, useEffect, useState } from 'react';
import { ApplyStatus } from '@/components/apply-status';
import { CardHeading, InfoRow } from '@/components/card-heading';
import { Field } from '@/components/field';
import { Logo } from '@/components/layout/sidebar';
import { PageHeader } from '@/components/layout/page-header';
import { FormSkeleton, LoadError } from '@/components/page-states';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useApply } from '@/hooks/use-apply';
import { useLoad } from '@/hooks/use-load';
import { refreshRouterMode, type RouterMode } from '@/lib/router-mode';
import { cn, errorMessage } from '@/lib/utils';
import { Choice, SwitchRow } from '../firewall/parts';
import { type Addressing, bridgeOffloadChange, getModeStatus, type LastSwitch, type ModeStatus, switchMode } from './api';
import { type ApForm, apAddress, initialForm, netmaskOf, prefixes, toRequest, validate } from './model';

const POLL_MS = 2000;
// a failed switch is worth a word on the page for this long afterwards
const RECENT_S = 15 * 60;

interface Step {
  icon?: LucideIcon;
  label: string;
  self?: boolean;
}

/** Internet → … → your devices, with MilkFlint where it sits in this mode. */
function Path({ steps }: { steps: readonly Step[] }): ReactElement {
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-hidden="true">
      {steps.map((s, i) => (
        <span key={s.label} className="flex items-center gap-1.5">
          {i > 0 && <ArrowRightIcon className="size-3.5 text-muted-foreground/60" />}
          <span
            className={cn(
              'flex items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-xs',
              s.self === true ? 'border-primary/40 bg-primary/5 font-medium text-foreground' : 'text-muted-foreground',
            )}
          >
            {s.icon !== undefined ? <s.icon className="size-3.5" /> : <Logo className="size-3.5" />}
            {s.label}
          </span>
        </span>
      ))}
    </div>
  );
}

const modes: readonly {
  mode: RouterMode;
  icon: LucideIcon;
  title: string;
  text: string;
  path: readonly Step[];
}[] = [
  {
    mode: 'router',
    icon: RouterIcon,
    title: 'Router',
    text: 'MilkFlint connects to the internet and runs your network: addresses, firewall, Smart Queue, DNS and guest Wi-Fi.',
    path: [
      { icon: GlobeIcon, label: 'Internet' },
      { label: 'MilkFlint', self: true },
      { icon: LaptopIcon, label: 'Your devices' },
    ],
  },
  {
    mode: 'ap',
    icon: RadioTowerIcon,
    title: 'Access point',
    text: 'Another router runs your network. MilkFlint joins it: its Wi-Fi and every port become part of that network.',
    path: [
      { icon: GlobeIcon, label: 'Internet' },
      { icon: RouterIcon, label: 'Main router' },
      { label: 'MilkFlint', self: true },
      { icon: LaptopIcon, label: 'Your devices' },
    ],
  },
];

/** The two modes, as big radio tiles; nothing changes until the switch button. */
function ModeTiles({
  value,
  current,
  disabled,
  onChange,
}: {
  value: RouterMode;
  current: RouterMode;
  disabled: boolean;
  onChange: (m: RouterMode) => void;
}): ReactElement {
  return (
    <div role="radiogroup" aria-label="Operating mode" className="grid gap-3 md:grid-cols-2">
      {modes.map((m) => {
        const selected = m.mode === value;
        return (
          <button
            key={m.mode}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => {
              onChange(m.mode);
            }}
            className={cn(
              'flex flex-col gap-4 rounded-xl border bg-card p-5 text-left transition-colors hover:border-primary/50 hover:bg-primary/5 disabled:pointer-events-none disabled:opacity-70',
              selected && 'border-primary bg-primary/5 ring-1 ring-primary',
            )}
          >
            <span className="flex items-center gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <m.icon className="size-5" />
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="flex items-center gap-2 text-base font-medium">
                  {m.title}
                  {m.mode === current && (
                    <Badge variant="secondary" className="font-normal">
                      Now
                    </Badge>
                  )}
                </span>
              </span>
              <span
                className={cn(
                  'ml-auto flex size-4 shrink-0 items-center justify-center rounded-full border',
                  selected && 'border-primary',
                )}
              >
                {selected && <span className="size-2 rounded-full bg-primary" />}
              </span>
            </span>
            <Path steps={m.path} />
            <span className="text-sm text-muted-foreground">{m.text}</span>
          </button>
        );
      })}
    </div>
  );
}

function ChangeItem({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }): ReactElement {
  return (
    <li className="flex items-start gap-3 py-2.5 text-sm">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <span>{children}</span>
    </li>
  );
}

function addressText(a: Addressing | null | undefined): string | undefined {
  if (a?.ipaddr === undefined || a.ipaddr === null) return undefined;
  return a.prefix === undefined || a.prefix === null ? a.ipaddr : `${a.ipaddr}/${String(a.prefix)}`;
}

/** Access point mode's address on the main router's network: automatic or fixed. */
function AddressCard({
  form,
  uplink,
  errors,
  set,
}: {
  form: ApForm;
  uplink: Addressing | null | undefined;
  errors: ReturnType<typeof validate>;
  set: <K extends keyof ApForm>(key: K, value: ApForm[K]) => void;
}): ReactElement {
  const network = uplink?.up === true ? addressText(uplink) : undefined;
  return (
    <Card>
      <CardHeading icon={NetworkIcon} title="Its address" description="Where you'll open this page after the switch." />
      <CardContent className="flex flex-col gap-3">
        {network !== undefined && (
          <p className="text-sm text-muted-foreground">
            The WAN port is on your main router&apos;s network now, at <span className="font-mono text-foreground">{network}</span>
            {uplink?.gateway !== undefined && uplink.gateway !== null && (
              <>
                , with the router at <span className="font-mono text-foreground">{uplink.gateway}</span>
              </>
            )}
            .
          </p>
        )}
        <Choice
          label="Address"
          value={form.proto}
          onChange={(v) => {
            set('proto', v);
          }}
          options={[
            {
              value: 'dhcp',
              label: 'From your main router',
              hint: 'Its DHCP server gives MilkFlint an address: look for MilkFlint in its list of devices.',
            },
            {
              value: 'static',
              label: 'A fixed address',
              hint: 'One you pick on its network, outside the range its DHCP server hands out, so it always answers there.',
            },
          ]}
        />
        {form.proto === 'static' && (
          <div className="divide-y">
            <Field id="ap-ipaddr" label="IP address" error={errors.ipaddr}>
              <Input
                id="ap-ipaddr"
                className="font-mono"
                placeholder="192.168.0.2"
                value={form.ipaddr}
                aria-invalid={errors.ipaddr !== undefined}
                onChange={(e) => {
                  set('ipaddr', e.target.value.trim());
                }}
              />
            </Field>
            <Field id="ap-prefix" label="Network size">
              <Select
                value={form.prefix}
                onValueChange={(v) => {
                  set('prefix', v);
                }}
              >
                <SelectTrigger id="ap-prefix">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {prefixes.map((p) => (
                    <SelectItem key={p} value={p}>
                      /{p} · {netmaskOf(Number(p))}
                    </SelectItem>
                  ))}
                  {!(prefixes as readonly string[]).includes(form.prefix) && (
                    <SelectItem value={form.prefix}>/{form.prefix}</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </Field>
            <Field id="ap-gateway" label="Main router" hint="Its address on this network." error={errors.gateway}>
              <Input
                id="ap-gateway"
                className="font-mono"
                placeholder="192.168.0.1"
                value={form.gateway}
                aria-invalid={errors.gateway !== undefined}
                onChange={(e) => {
                  set('gateway', e.target.value.trim());
                }}
              />
            </Field>
            <Field id="ap-dns" label="DNS servers" hint="For MilkFlint's own lookups. Blank: your main router." error={errors.dns}>
              <Input
                id="ap-dns"
                className="font-mono"
                placeholder={form.gateway === '' ? '192.168.0.1' : form.gateway}
                value={form.dns}
                aria-invalid={errors.dns !== undefined}
                onChange={(e) => {
                  set('dns', e.target.value);
                }}
              />
            </Field>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function BridgeOffloadRow({
  checked,
  available,
  disabled,
  onChange,
}: {
  checked: boolean;
  available: boolean;
  disabled: boolean;
  onChange: (on: boolean) => void;
}): ReactElement {
  return (
    <SwitchRow
      id="bridge-offload"
      boxed
      checked={checked && available}
      disabled={disabled || !available}
      onChange={onChange}
      title={
        <span className="flex items-center gap-2">
          Faster bridging
          <Badge variant="outline" className="font-normal">
            Experimental
          </Badge>
        </span>
      }
      hint={
        available
          ? 'Connections between devices on this network (Wi-Fi to wired, or to your main router) take a shorter way through MilkFlint, meant to save processor time. It doesn’t change what’s allowed through: only connections the bridge passes anyway take it, and every frame is checked. Router mode turns it off.'
          : 'This image has no bridge fast path.'
      }
    />
  );
}

/** Router mode, access point picked: its settings, what changes, and the switch. */
function ToAccessPoint({
  status,
  busy,
  onSwitch,
}: {
  status: ModeStatus;
  busy: boolean;
  onSwitch: (form: ApForm) => void;
}): ReactElement {
  const [form, setForm] = useState(() => initialForm(status.uplink, status.bridge_offload));
  const errors = validate(form);
  const set = <K extends keyof ApForm>(key: K, value: ApForm[K]): void => {
    setForm((f) => ({ ...f, [key]: value }));
  };
  const port = status.wan_port ?? 'WAN';
  return (
    <div className="grid items-start gap-4 xl:grid-cols-2">
      <AddressCard form={form} uplink={status.uplink} errors={errors} set={set} />
      <Card>
        <CardHeading icon={ToggleLeftIcon} title="When it switches" description="Your other settings stay, for when you switch back." />
        <CardContent className="flex flex-col gap-4">
          <ul className="divide-y">
            <ChangeItem icon={CableIcon}>
              The WAN port (<span className="font-mono">{port}</span>) becomes one more LAN port. Plug your main router into it,
              or into any port.
            </ChangeItem>
            <ChangeItem icon={ServerOffIcon}>
              MilkFlint stops handing out addresses and IPv6 settings: your main router does that for every device.
            </ChangeItem>
            <ChangeItem icon={RouterIcon}>
              Smart Queue, UPnP and guest Wi-Fi turn off. Their pages leave the menu, with the others only a router needs:
              Internet, LAN, IPv6, Firewall, DNS, VPN and Data Statistics.
            </ChangeItem>
            <ChangeItem icon={WifiIcon}>Your Wi-Fi networks keep their names and passwords.</ChangeItem>
            <ChangeItem icon={Undo2Icon}>
              If MilkFlint can&apos;t reach your main router within two minutes, it goes back to router mode by itself.
            </ChangeItem>
          </ul>
          <BridgeOffloadRow
            checked={form.bridgeOffload}
            available={status.bridge_offload_available}
            disabled={busy}
            onChange={(on) => {
              set('bridgeOffload', on);
            }}
          />
          <Button
            className="self-start"
            disabled={busy || Object.keys(errors).length > 0}
            onClick={() => {
              onSwitch(form);
            }}
          >
            <RadioTowerIcon />
            Switch to access point mode
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

/** Access point mode, router picked: what comes back, and the switch. */
function ToRouter({ status, busy, onSwitch }: { status: ModeStatus; busy: boolean; onSwitch: () => void }): ReactElement {
  const address = status.router_address ?? '192.168.1.1';
  const handmade = status.handmade === true;
  return (
    <Card>
      <CardHeading
        icon={RouterIcon}
        title={handmade ? 'To router mode' : 'Back to router mode'}
        description={
          handmade
            ? 'This access point was set up outside this page, so MilkFlint takes OpenWrt’s router settings.'
            : 'MilkFlint takes back the settings it had before.'
        }
      />
      <CardContent className="flex flex-col gap-4">
        <ul className="divide-y">
          <ChangeItem icon={NetworkIcon}>
            {handmade ? 'Its own network' : 'Its own network again'}, at <span className="font-mono">http://{address}/</span>, with
            its DHCP server{handmade ? ', its firewall and IPv6 settings, turned on if they were off' : ''}.
          </ChangeItem>
          <ChangeItem icon={CableIcon}>
            The WAN port goes back to the internet (or to your main router, as its internet). Move the cable if it&apos;s
            in a LAN port.
          </ChangeItem>
          <ChangeItem icon={RouterIcon}>
            {handmade ? 'Faster bridging turns off.' : 'Smart Queue, UPnP and guest Wi-Fi come back as they were. Faster bridging turns off.'}
          </ChangeItem>
          <ChangeItem icon={LaptopIcon}>Your device then needs MilkFlint&apos;s Wi-Fi or a LAN port to reach it.</ChangeItem>
        </ul>
        <Button className="self-start" disabled={busy} onClick={onSwitch}>
          <RouterIcon />
          Switch to router mode
        </Button>
      </CardContent>
    </Card>
  );
}

/** Access point mode as it is: its address, the main router, and the bridge fast path. */
function AccessPointNow({ status, onReload }: { status: ModeStatus; onReload: () => void }): ReactElement {
  const onApplied = useCallback(() => {
    onReload();
  }, [onReload]);
  const { state, apply } = useApply(onApplied);
  const now = status.lan_now;
  const section = status.firewall_defaults;
  const toggle = (on: boolean): void => {
    if (section !== undefined && section !== null) void apply([bridgeOffloadChange(section, on)]);
  };
  return (
    <div className="flex flex-col gap-4">
      <ApplyStatus state={state} />
      <div className="grid items-start gap-4 xl:grid-cols-2">
        <Card>
          <CardHeading
            icon={RadioTowerIcon}
            title="On your main router's network"
            description={`${status.lan.proto === 'dhcp' ? 'Its address comes from your main router.' : 'At a fixed address.'}${
              status.handmade === true ? ' Set up outside this page (by hand or in LuCI).' : ''
            }`}
          />
          <CardContent className="divide-y">
            <InfoRow label="Address">
              <span className="font-mono">{addressText(now) ?? 'waiting for one'}</span>
            </InfoRow>
            <InfoRow label="Main router">
              <span className="font-mono">{now?.gateway ?? status.lan.gateway ?? '—'}</span>
            </InfoRow>
            <InfoRow label="Connection">
              <span className="flex items-center justify-end gap-2">
                <span className={cn('size-2 rounded-full', now?.up === true ? 'bg-success' : 'bg-destructive')} />
                {now?.up === true ? 'Up' : 'Down'}
              </span>
            </InfoRow>
          </CardContent>
        </Card>
        <Card>
          <CardHeading icon={ZapIcon} title="Bridging" description="How MilkFlint passes traffic between its ports and Wi-Fi." />
          <CardContent>
            <BridgeOffloadRow
              checked={status.bridge_offload}
              available={status.bridge_offload_available}
              disabled={state.phase === 'applying' || section === undefined || section === null}
              onChange={toggle}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

type Progress =
  | { phase: 'idle' }
  | { phase: 'starting'; target: RouterMode }
  /** at: when it started by the browser's clock (for the countdown); routerAt: by the router's */
  | { phase: 'started'; target: RouterMode; seconds: number; at: number; routerAt: number; url: string | undefined }
  | { phase: 'error'; message: string };

const modeName = (m: RouterMode): string => (m === 'ap' ? 'access point' : 'router');

/** The switch under way, and how the last one ended. */
function SwitchStatus({
  progress,
  status,
  reachable,
  now,
}: {
  progress: Progress;
  status: ModeStatus;
  reachable: boolean;
  now: number;
}): ReactElement | null {
  // during a switch, only its own outcome (an earlier one's is in the file until it starts)
  const last: LastSwitch | null | undefined =
    progress.phase === 'started' && (status.last?.started ?? 0) < progress.routerAt ? undefined : status.last;
  if (progress.phase === 'error') {
    return (
      <Alert variant="destructive">
        <TriangleAlertIcon />
        <AlertTitle>Couldn&apos;t start the switch</AlertTitle>
        <AlertDescription>{progress.message}</AlertDescription>
      </Alert>
    );
  }
  if (progress.phase === 'starting' || (progress.phase === 'started' && last?.state !== 'failed' && last?.state !== 'done')) {
    const target = progress.target;
    const left = progress.phase === 'started' ? Math.max(0, Math.ceil(progress.seconds - (now - progress.at) / 1000)) : undefined;
    const url = progress.phase === 'started' ? progress.url : undefined;
    return (
      <Alert variant="info">
        <LoaderCircleIcon className="animate-spin" />
        <AlertTitle>Switching to {modeName(target)} mode…</AlertTitle>
        <AlertDescription>
          <span>
            {reachable ? 'This page stops answering in a moment. ' : 'This page has lost the router, as expected. '}
            Reconnect your device (rejoin the Wi-Fi, or unplug and replug the cable), then open MilkFlint{' '}
            {url !== undefined ? (
              <>
                at{' '}
                <a href={url} className="font-medium text-foreground underline underline-offset-2">
                  {url}
                </a>
              </>
            ) : (
              'at the address your main router gives it (look for MilkFlint in its list of devices)'
            )}
            .{' '}
            {left !== undefined &&
              (left > 0
                ? `If the new mode doesn’t work, it goes back by itself in about ${String(left)} s, and this page works again.`
                : 'If the new mode didn’t work, it is back as it was: reload this page.')}
          </span>
        </AlertDescription>
      </Alert>
    );
  }
  if (last?.state === 'failed' && last.finished !== undefined && status.now - last.finished < RECENT_S) {
    return (
      <Alert variant="warning">
        <Undo2Icon />
        <AlertTitle>Still in {modeName(last.mode ?? last.from ?? 'router')} mode</AlertTitle>
        <AlertDescription>
          The switch to {modeName(last.target ?? 'ap')} mode didn&apos;t work ({last.error ?? 'no reason given'}), so MilkFlint
          went back to how it was.
        </AlertDescription>
      </Alert>
    );
  }
  if (progress.phase === 'started' && last?.state === 'done') {
    return (
      <Alert variant="success">
        <CheckCircle2Icon />
        <AlertTitle>In {modeName(last.mode ?? progress.target)} mode</AlertTitle>
        {last.address !== undefined && last.address !== null && (
          <AlertDescription>
            At <span className="font-mono">{last.address}</span>.
          </AlertDescription>
        )}
      </Alert>
    );
  }
  return null;
}

export function ModePage(): ReactElement {
  const { data, error, loading, reload } = useLoad(getModeStatus);
  const [choice, setChoice] = useState<RouterMode>();
  const [pending, setPending] = useState<{ target: RouterMode; form?: ApForm }>();
  const [progress, setProgress] = useState<Progress>({ phase: 'idle' });
  const [live, setLive] = useState<{ status?: ModeStatus; reachable: boolean }>({ reachable: true });
  const [now, setNow] = useState(() => Date.now());

  // while a switch runs: follow it as long as the router answers
  const following = progress.phase === 'started';
  useEffect(() => {
    if (!following) return undefined;
    let cancelled = false;
    const t = window.setInterval(() => {
      setNow(Date.now());
      getModeStatus().then(
        (s) => {
          if (cancelled) return;
          setLive({ status: s, reachable: true });
          if (!s.switching && s.last?.state !== 'switching') {
            void refreshRouterMode();
            reload();
          }
        },
        () => {
          if (!cancelled) setLive((l) => ({ ...l, reachable: false }));
        },
      );
    }, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [following, reload]);

  const status = following ? (live.status ?? data) : data;
  const current = status?.mode ?? 'router';
  const selected = choice ?? current;
  const busy = progress.phase === 'starting' || progress.phase === 'started' || status?.switching === true;

  const start = (target: RouterMode, form?: ApForm): void => {
    setPending(undefined);
    setProgress({ phase: 'starting', target });
    const address = target === 'ap' ? (form === undefined ? undefined : apAddress(form)) : (status?.router_address ?? '192.168.1.1');
    switchMode(target === 'ap' && form !== undefined ? toRequest(form) : { mode: 'router' }).then(
      ({ at, seconds }) => {
        setNow(Date.now());
        setProgress({
          phase: 'started',
          target,
          seconds,
          at: Date.now(),
          routerAt: at,
          url: address === undefined ? undefined : `http://${address}/`,
        });
      },
      (err: unknown) => {
        setProgress({ phase: 'error', message: errorMessage(err) });
      },
    );
  };

  return (
    <>
      <PageHeader
        title="Operating Mode"
        description="MilkFlint as your main router, or as an access point that adds its Wi-Fi to another router's network."
      />
      <div className="flex flex-col gap-4">
        {status !== undefined && (
          <SwitchStatus progress={progress} status={status} reachable={live.reachable} now={now} />
        )}
        {error !== undefined && data === undefined ? (
          <LoadError error={error} retry={reload} />
        ) : loading || status === undefined ? (
          <FormSkeleton />
        ) : (
          <>
            <Card>
              <CardHeading
                icon={RouterIcon}
                title="How MilkFlint connects"
                description={selected === current ? 'Pick the other one to switch.' : 'Nothing changes until you switch, below.'}
              />
              <CardContent>
                <ModeTiles value={selected} current={current} disabled={busy} onChange={setChoice} />
              </CardContent>
            </Card>
            {selected === 'ap' && current === 'router' && (
              <ToAccessPoint
                status={status}
                busy={busy}
                onSwitch={(form) => {
                  setPending({ target: 'ap', form });
                }}
              />
            )}
            {selected === 'router' && current === 'ap' && (
              <ToRouter
                status={status}
                busy={busy}
                onSwitch={() => {
                  setPending({ target: 'router' });
                }}
              />
            )}
            {selected === 'ap' && current === 'ap' && <AccessPointNow status={status} onReload={reload} />}
          </>
        )}
      </div>
      <Dialog
        open={pending !== undefined}
        onOpenChange={(open) => {
          if (!open) setPending(undefined);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Switch to {modeName(pending?.target ?? 'ap')} mode?</DialogTitle>
            <DialogDescription>
              {pending?.target === 'ap'
                ? `This page loses its connection. MilkFlint then answers ${
                    pending.form !== undefined && apAddress(pending.form) !== undefined
                      ? `at http://${apAddress(pending.form) ?? ''}/`
                      : 'at the address your main router gives it (look for MilkFlint in its list of devices)'
                  }, once your device has reconnected. If it can’t reach your main router within two minutes, it goes back to router mode by itself.`
                : `This page loses its connection. MilkFlint then answers at http://${status?.router_address ?? '192.168.1.1'}/ on its own Wi-Fi and LAN ports. If its LAN doesn’t come up, it goes back to access point mode by itself.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setPending(undefined);
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (pending !== undefined) start(pending.target, pending.form);
              }}
            >
              Switch
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
