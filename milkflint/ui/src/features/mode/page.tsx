// Operating mode: MilkFlint as the main router, or as an access point on
// another router's network. It opens on how it runs now and whether that's
// working, then the two modes to pick from with their diagrams; picking the
// other shows what the switch changes and the button that starts it (the
// router does it in the background, and goes back by itself if the new mode
// doesn't work). In access point mode the bridge fast path can be turned on.
import {
  CableIcon,
  CheckCircle2Icon,
  LaptopIcon,
  LoaderCircleIcon,
  NetworkIcon,
  RadioTowerIcon,
  RouterIcon,
  ServerOffIcon,
  TriangleAlertIcon,
  Undo2Icon,
  WifiIcon,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { type ReactElement, useCallback, useEffect, useState } from 'react';
import { ApplyStatus } from '@/components/apply-status';
import { CardHeading } from '@/components/card-heading';
import { SelectField, TextField } from '@/components/form';
import { PageHeader } from '@/components/layout/page-header';
import { FormSkeleton, LoadError } from '@/components/page-states';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useApply } from '@/hooks/use-apply';
import { formErrors } from '@/lib/form/errors';
import { useFormValues, useSettingsForm } from '@/lib/form/use-settings-form';
import { useLive } from '@/lib/query/use-live';
import { pageLink } from '@/lib/router';
import { refreshRouterMode, type RouterMode } from '@/lib/router-mode';
import { routerUrl } from '@/lib/router-url';
import { errorMessage } from '@/lib/utils';
import { Answer, AnswerCell, ChoiceCards, Figure, GoLink } from '@/components/page-kit';
import { MoreSettings } from '@/components/more-settings';
import { bridgeOffloadChange, type LastSwitch, type ModeStatus } from './api';
import {
  addressText,
  type ApForm,
  apAddress,
  apFormSchema,
  initialForm,
  modeName,
  netmaskOf,
  prefixes,
  toRequest,
} from './model';
import { FOLLOW_MS, modeQueries, useSwitchMode } from './queries';
import { BridgeField, ChangeItem, ModeChoice } from './parts';

// a failed switch is worth a word on the page for this long afterwards
const RECENT_S = 15 * 60;

/** How MilkFlint runs now, and whether that's working: the page's answer. */
function ModeAnswer({ status }: { status: ModeStatus }): ReactElement {
  const now = status.lan_now;
  if (status.mode === 'ap') {
    const up = now?.up === true;
    return (
      <Answer columns={3}>
        <AnswerCell title="Mode now" value={<Figure>Access point</Figure>}>
          {status.handmade === true
            ? 'Set up outside this page (by hand or in LuCI).'
            : 'Your main router runs the network; MilkFlint adds its Wi-Fi and ports.'}
        </AnswerCell>
        <AnswerCell
          title="On your main router’s network"
          value={up ? <Badge variant="success">Connected</Badge> : <Badge variant="destructive">Not connected</Badge>}
        >
          {addressText(now) === undefined ? (
            'Waiting for an address.'
          ) : (
            <>
              At <span className="font-mono text-foreground">{addressText(now)}</span>
              {status.lan.proto === 'dhcp' ? ', from your main router.' : ', a fixed address.'}
            </>
          )}
        </AnswerCell>
        <AnswerCell title="Main router" value={<Figure>{now?.gateway ?? status.lan.gateway ?? '—'}</Figure>}>
          Its own settings page runs addresses, the firewall and the internet connection.
        </AnswerCell>
      </Answer>
    );
  }
  const wan = status.uplink;
  const lanAddress = now?.ipaddr ?? status.lan.ipaddr;
  return (
    <Answer columns={3}>
      <AnswerCell title="Mode now" value={<Figure>Router</Figure>}>
        MilkFlint connects to the internet and runs your network.
      </AnswerCell>
      <AnswerCell
        title="Internet (WAN port)"
        value={wan?.up === true ? <Badge variant="success">Connected</Badge> : <Badge variant="destructive">Not connected</Badge>}
        action={<GoLink to={pageLink('internet')}>Internet</GoLink>}
      >
        {addressText(wan) === undefined ? (
          'No address on it yet.'
        ) : (
          <>
            At <span className="font-mono text-foreground">{addressText(wan)}</span>
            {wan?.gateway !== undefined && wan.gateway !== null && (
              <>
                , via <span className="font-mono text-foreground">{wan.gateway}</span>
              </>
            )}
            .
          </>
        )}
      </AnswerCell>
      <AnswerCell
        title="Its address"
        value={<Figure>{lanAddress ?? '—'}</Figure>}
        action={<GoLink to={pageLink('lan')}>LAN & DHCP</GoLink>}
      >
        Where your devices find it, and this page.
      </AnswerCell>
    </Answer>
  );
}

/** Router mode, access point picked: its address on the main router's network, what changes, and the switch. */
function ToAccessPoint({
  status,
  busy,
  onSwitch,
}: {
  status: ModeStatus;
  busy: boolean;
  onSwitch: (form: ApForm) => void;
}): ReactElement {
  // where it starts: kept as it was first drawn, so a status read meanwhile doesn't move it
  const [start] = useState(() => initialForm(status.uplink, status.bridge_offload));
  const settings = useSettingsForm({ schema: apFormSchema, saved: start, onSave: onSwitch });
  const { form: fields } = settings;
  const form = useFormValues(fields);
  // the checks as they stand: the switch stays off until they pass
  const valid = Object.keys(formErrors(apFormSchema, form)).length === 0;
  const port = status.wan_port ?? 'WAN';
  const network = status.uplink?.up === true ? addressText(status.uplink) : undefined;
  return (
    <Card>
      <CardHeading title="Switch to access point mode" description="Your other settings stay, for when you switch back." />
      <CardContent className="flex flex-col gap-6">
        <section aria-labelledby="ap-address" className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h3 id="ap-address" className="text-sm font-medium">
              Its address after the switch
            </h3>
            <p className="text-xs text-muted-foreground">
              Where you’ll open this page.
              {network !== undefined && (
                <>
                  {' '}
                  The WAN port is on your main router’s network now, at{' '}
                  <span className="font-mono text-foreground">{network}</span>
                  {status.uplink?.gateway !== undefined && status.uplink.gateway !== null && (
                    <>
                      , with the router at <span className="font-mono text-foreground">{status.uplink.gateway}</span>
                    </>
                  )}
                  .
                </>
              )}
            </p>
          </div>
          <ChoiceCards
            label="Its address"
            columns={2}
            value={form.proto}
            disabled={busy}
            onChange={(v) => {
              fields.setFieldValue('proto', v);
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
              <fields.Field name="ipaddr">
                {(field) => (
                  <TextField
                    field={field}
                    id="ap-ipaddr"
                    label="IP address"
                    className="font-mono"
                    placeholder="192.168.0.2"
                    trim
                  />
                )}
              </fields.Field>
              <fields.Field name="prefix">
                {(field) => (
                  <SelectField
                    field={field}
                    id="ap-prefix"
                    label="Network size"
                    options={[
                      ...prefixes.map((p) => ({ value: p, label: `/${p} · ${netmaskOf(Number(p))}` })),
                      ...((prefixes as readonly string[]).includes(form.prefix)
                        ? []
                        : [{ value: form.prefix, label: `/${form.prefix}` }]),
                    ]}
                  />
                )}
              </fields.Field>
              <fields.Field name="gateway">
                {(field) => (
                  <TextField
                    field={field}
                    id="ap-gateway"
                    label="Main router"
                    hint="Its address on this network."
                    className="font-mono"
                    placeholder="192.168.0.1"
                    trim
                  />
                )}
              </fields.Field>
              <fields.Field name="dns">
                {(field) => (
                  <TextField
                    field={field}
                    id="ap-dns"
                    label="DNS servers"
                    hint="For MilkFlint’s own lookups. Blank: your main router."
                    className="font-mono"
                    placeholder={form.gateway === '' ? '192.168.0.1' : form.gateway}
                  />
                )}
              </fields.Field>
            </div>
          )}
        </section>
        <section aria-labelledby="ap-changes" className="flex flex-col gap-1">
          <h3 id="ap-changes" className="text-sm font-medium">
            What changes
          </h3>
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
              Internet, LAN, IPv6, Firewall, DNS, VPN and Data usage.
            </ChangeItem>
            <ChangeItem icon={WifiIcon}>Your Wi-Fi networks keep their names and passwords.</ChangeItem>
            <ChangeItem icon={Undo2Icon}>
              If MilkFlint can’t reach your main router within two minutes, it goes back to router mode by itself.
            </ChangeItem>
          </ul>
        </section>
        <div className="-mt-3">
          <MoreSettings summary={form.bridgeOffload && status.bridge_offload_available ? 'faster bridging on' : undefined}>
            <BridgeField
              checked={form.bridgeOffload}
              available={status.bridge_offload_available}
              disabled={busy}
              onChange={(on) => {
                fields.setFieldValue('bridgeOffload', on);
              }}
            />
          </MoreSettings>
        </div>
      </CardContent>
      <CardFooter className="flex-wrap gap-x-4 gap-y-2">
        <Button disabled={busy || !valid} onClick={settings.save}>
          <RadioTowerIcon />
          Switch to access point mode
        </Button>
        <p className="text-xs text-muted-foreground">This page loses its connection; it asks first.</p>
      </CardFooter>
    </Card>
  );
}

/** Access point mode, router picked: what comes back, and the switch. */
function ToRouter({ status, busy, onSwitch }: { status: ModeStatus; busy: boolean; onSwitch: () => void }): ReactElement {
  const address = status.router_address ?? '192.168.1.1';
  const handmade = status.handmade === true;
  return (
    <Card>
      <CardHeading
        title={handmade ? 'Switch to router mode' : 'Back to router mode'}
        status={
          handmade
            ? 'This access point was set up outside this page, so MilkFlint takes OpenWrt’s router settings.'
            : 'MilkFlint takes back the settings it had before.'
        }
      />
      <CardContent className="flex flex-col gap-5">
        <section aria-labelledby="router-changes" className="flex flex-col gap-1">
          <h3 id="router-changes" className="text-sm font-medium">
            What changes
          </h3>
          <ul className="divide-y">
            <ChangeItem icon={NetworkIcon}>
              {handmade ? 'Its own network' : 'Its own network again'}, at <span className="font-mono">{routerUrl(address)}</span>
              , with its DHCP server
              {handmade ? ', its firewall and IPv6 settings, turned on if they were off' : ''}.
            </ChangeItem>
            <ChangeItem icon={CableIcon}>
              The WAN port goes back to the internet (or to your main router, as its internet). Move the cable if it’s in a LAN
              port.
            </ChangeItem>
            <ChangeItem icon={RouterIcon}>
              {handmade
                ? 'Faster bridging turns off.'
                : 'Smart Queue, UPnP and guest Wi-Fi come back as they were. Faster bridging turns off.'}
            </ChangeItem>
            <ChangeItem icon={LaptopIcon}>Your device then needs MilkFlint’s Wi-Fi or a LAN port to reach it.</ChangeItem>
          </ul>
        </section>
      </CardContent>
      <CardFooter className="flex-wrap gap-x-4 gap-y-2">
        <Button disabled={busy} onClick={onSwitch}>
          <RouterIcon />
          Switch to router mode
        </Button>
        <p className="text-xs text-muted-foreground">This page loses its connection; it asks first.</p>
      </CardFooter>
    </Card>
  );
}

/** Access point mode as it is: the bridge fast path, applied as it's switched. */
function Bridging({ status }: { status: ModeStatus }): ReactElement {
  // a change reads the status again (useApply refreshes every query)
  const { state, apply } = useApply();
  const section = status.firewall_defaults;
  const toggle = (on: boolean): void => {
    if (section !== undefined && section !== null) void apply([bridgeOffloadChange(section, on)]);
  };
  return (
    <>
      <ApplyStatus state={state} />
      <Card>
        <CardHeading
          title="Bridging"
          description="How MilkFlint passes traffic between its ports and Wi-Fi. A change applies at once."
        />
        <CardContent>
          <BridgeField
            checked={status.bridge_offload}
            available={status.bridge_offload_available}
            disabled={state.phase === 'applying' || section === undefined || section === null}
            onChange={toggle}
          />
        </CardContent>
      </Card>
    </>
  );
}

type Progress =
  | { phase: 'idle' }
  | { phase: 'starting'; target: RouterMode }
  /** at: when it started by the browser's clock (for the countdown); routerAt: by the router's */
  | { phase: 'started'; target: RouterMode; seconds: number; at: number; routerAt: number; url: string | undefined }
  | { phase: 'error'; message: string };

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
      <Alert variant="destructive" role="alert">
        <TriangleAlertIcon />
        <AlertTitle>Couldn’t start the switch</AlertTitle>
        <AlertDescription>{progress.message}</AlertDescription>
      </Alert>
    );
  }
  if (progress.phase === 'starting' || (progress.phase === 'started' && last?.state !== 'failed' && last?.state !== 'done')) {
    const target = progress.target;
    const left = progress.phase === 'started' ? Math.max(0, Math.ceil(progress.seconds - (now - progress.at) / 1000)) : undefined;
    const url = progress.phase === 'started' ? progress.url : undefined;
    return (
      <Alert variant="info" role="status">
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
          The switch to {modeName(last.target ?? 'ap')} mode didn’t work ({last.error ?? 'no reason given'}), so MilkFlint went
          back to how it was.
        </AlertDescription>
      </Alert>
    );
  }
  if (progress.phase === 'started' && last?.state === 'done') {
    return (
      <Alert variant="success" role="status">
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
  const query = useQuery(modeQueries.status());
  const { data, refetch } = query;
  const error = query.error ?? undefined;
  const reload = useCallback(() => {
    void refetch();
  }, [refetch]);
  const switching = useSwitchMode();
  const [choice, setChoice] = useState<RouterMode>();
  const [pending, setPending] = useState<{ target: RouterMode; form?: ApForm }>();
  const [progress, setProgress] = useState<Progress>({ phase: 'idle' });
  const [now, setNow] = useState(() => Date.now());

  // while a switch runs: follow it as long as the router answers
  const following = progress.phase === 'started';
  const live = useLive(modeQueries.following(following));
  const reachable = live.error === undefined;
  useEffect(() => {
    if (!following) return undefined;
    const t = window.setInterval(() => {
      setNow(Date.now());
    }, FOLLOW_MS);
    return () => {
      window.clearInterval(t);
    };
  }, [following]);
  // once it has ended: the menu follows the mode, and the page reads it again
  const ended = following && live.data !== undefined && !live.data.switching && live.data.last?.state !== 'switching';
  useEffect(() => {
    if (!ended) return;
    void refreshRouterMode();
    reload();
  }, [ended, live.at, reload]);

  const status = following ? (live.data ?? data) : data;
  const current = status?.mode ?? 'router';
  const selected = choice ?? current;
  const busy = progress.phase === 'starting' || progress.phase === 'started' || status?.switching === true;

  const start = (target: RouterMode, form?: ApForm): void => {
    setPending(undefined);
    setProgress({ phase: 'starting', target });
    const address =
      target === 'ap' ? (form === undefined ? undefined : apAddress(form)) : (status?.router_address ?? '192.168.1.1');
    switching.mutateAsync(target === 'ap' && form !== undefined ? toRequest(form) : { mode: 'router' }).then(
      ({ at, seconds }) => {
        setNow(Date.now());
        setProgress({
          phase: 'started',
          target,
          seconds,
          at: Date.now(),
          routerAt: at,
          url: address === undefined ? undefined : routerUrl(address),
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
        title="Operating mode"
        description="MilkFlint as your main router, or as an access point that adds its Wi-Fi to another router’s network."
      />
      <div className="flex flex-col gap-4">
        {status !== undefined && <SwitchStatus progress={progress} status={status} reachable={reachable} now={now} />}
        {error !== undefined && data === undefined ? (
          <LoadError error={error} retry={reload} />
        ) : status === undefined ? (
          <FormSkeleton />
        ) : (
          <>
            <ModeAnswer status={status} />
            <Card>
              <CardHeading
                title="Router or access point"
                status={selected === current ? 'Pick the other one to switch.' : 'Nothing changes until you switch, below.'}
              />
              <CardContent>
                <ModeChoice value={selected} current={current} disabled={busy} onChange={setChoice} />
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
            {selected === 'ap' && current === 'ap' && <Bridging status={status} />}
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
                      ? `at ${routerUrl(apAddress(pending.form) ?? '')}`
                      : 'at the address your main router gives it (look for MilkFlint in its list of devices)'
                  }, once your device has reconnected. If it can’t reach your main router within two minutes, it goes back to router mode by itself.`
                : `This page loses its connection. MilkFlint then answers at ${routerUrl(status?.router_address ?? '192.168.1.1')} on its own Wi-Fi and LAN ports. If its LAN doesn’t come up, it goes back to access point mode by itself.`}
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
