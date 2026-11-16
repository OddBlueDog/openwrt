// UPnP: letting games and apps open ports on the internet address
// themselves (miniupnpd: UPnP IGD and NAT-PMP/PCP). It opens on the answer:
// on or off, secure mode, and the ports devices have open now, which Port
// forwards lists too. Settings are upnpd.config's; the open ports come from
// the router side (milkflint.upnp), live.
import { ChevronRightIcon, EraserIcon, ShieldAlertIcon } from 'lucide-react';
import { type ReactElement, type ReactNode, useCallback, useState } from 'react';
import { z } from 'zod';
import { ApplyStatus } from '@/components/apply-status';
import { CardHeading } from '@/components/card-heading';
import { Field } from '@/components/field';
import { PageHeader } from '@/components/layout/page-header';
import { Note } from '@/components/note';
import { FormSkeleton, LoadError } from '@/components/page-states';
import { SaveBar } from '@/components/save-bar';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useApply } from '@/hooks/use-apply';
import { useLoad } from '@/hooks/use-load';
import { usePoll } from '@/hooks/use-poll';
import { getLeases } from '@/lib/api/network';
import { bool, type Change, getConfig, type Section } from '@/lib/api/uci';
import { formatDuration } from '@/lib/format';
import { href } from '@/lib/router';
import { call, exec } from '@/lib/ubus';
import { MoreSettings } from '@/components/more-settings';

const mappingSchema = z.object({
  proto: z.string(),
  ext_port: z.number(),
  int_addr: z.string(),
  int_port: z.number(),
  remaining: z.number().nullable(),
  description: z.string(),
});

type Mapping = z.output<typeof mappingSchema> & { device: string | undefined };

async function getMappings(): Promise<Mapping[]> {
  const [{ mappings }, leases] = await Promise.all([
    call('milkflint.upnp', 'mappings', {}, z.object({ mappings: z.array(mappingSchema) })),
    getLeases().catch(() => []),
  ]);
  const names = new Map(leases.map((l) => [l.ipaddr, l.hostname]));
  return mappings.map((m) => ({ ...m, device: names.get(m.int_addr) }));
}

interface UpnpForm {
  enabled: boolean;
  upnp: boolean;
  natpmp: boolean;
  secure: boolean;
}

async function loadUpnp(): Promise<UpnpForm | null> {
  const s = (await getConfig('upnpd').catch((): Section[] => [])).find((x) => x['.name'] === 'config');
  if (s === undefined) return null;
  return {
    enabled: bool(s, 'enabled'),
    upnp: bool(s, 'enable_upnp', true),
    natpmp: bool(s, 'enable_natpmp', true),
    secure: bool(s, 'secure_mode', true),
  };
}

const toChanges = (f: UpnpForm): Change[] => [
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

const link = 'link inline-flex w-fit items-center gap-0.5 text-sm font-medium underline-offset-4';

function Cell({ title, status, children }: { title: string; status: ReactNode; children: ReactNode }): ReactElement {
  return (
    <div className="flex min-w-0 flex-col gap-2 p-5">
      <h2 className="text-sm font-medium text-muted-foreground">{title}</h2>
      <div className="flex min-h-6 items-center">{status}</div>
      <div className="flex flex-col gap-2 text-sm text-foreground">{children}</div>
    </div>
  );
}

const plural = (n: number, one: string, many: string): string => `${String(n)} ${n === 1 ? one : many}`;

/** The answer: on or off as saved, secure mode, and the ports devices have open now. */
function Answer({ saved, mappings }: { saved: UpnpForm; mappings: readonly Mapping[] | undefined }): ReactElement {
  const open = mappings?.length;
  const devices = new Set(mappings?.map((m) => m.int_addr)).size;
  return (
    <Card className="gap-0 py-0">
      <div className="grid divide-y md:grid-cols-3 md:divide-x md:divide-y-0">
        <Cell
          title="Automatic port opening"
          status={saved.enabled ? <Badge variant="success">On</Badge> : <Badge variant="secondary">Off</Badge>}
        >
          {saved.enabled
            ? 'Devices on your network can open ports on your internet address to themselves for a while; the router closes each when the device lets go of it or its time runs out.'
            : 'Devices can’t open ports themselves, so games and consoles may report a strict NAT type. Ports you open by hand still work.'}
        </Cell>
        <Cell
          title="Secure mode"
          status={
            saved.secure ? (
              <Badge variant="success">On</Badge>
            ) : (
              <Badge variant={saved.enabled ? 'warning' : 'secondary'}>Off</Badge>
            )
          }
        >
          {saved.secure
            ? 'A device can only open ports to itself.'
            : 'Any device can open ports to any other device on your network.'}
        </Cell>
        <Cell
          title="Open now"
          status={
            <span className="text-lg font-semibold tabular">{open === undefined ? '–' : plural(open, 'port', 'ports')}</span>
          }
        >
          <p>
            {open === undefined
              ? 'Asking the router…'
              : open === 0
                ? saved.enabled
                  ? 'No device has opened a port.'
                  : 'None: UPnP is off.'
                : `Opened by ${plural(devices, 'device', 'devices')}, listed below.`}
          </p>
          <a href={href('port-forwards')} className={link}>
            Port forwards, which lists them too
            <ChevronRightIcon className="size-4" />
          </a>
        </Cell>
      </div>
    </Card>
  );
}

const expires = (m: Mapping): string => (m.remaining === null ? 'when UPnP restarts' : `in ${formatDuration(m.remaining)}`);
const app = (m: Mapping): string => (m.description === '' ? 'No description' : m.description);

/** The ports devices opened, live: a table on a wide screen, a list on a phone. */
function OpenPorts({
  mappings,
  enabled,
  onClear,
}: {
  mappings: readonly Mapping[] | undefined;
  enabled: boolean;
  onClear: () => void;
}): ReactElement {
  const rows = mappings ?? [];
  return (
    <Card className="pb-0">
      <CardHeading
        title="Ports devices opened"
        description="Live. To open one yourself, use Port forwards."
        action={
          <Button variant="outline" size="sm" disabled={rows.length === 0} onClick={onClear}>
            <EraserIcon /> Clear all
          </Button>
        }
      />
      {rows.length === 0 ? (
        <CardContent className="border-t py-5">
          <p className="text-sm text-muted-foreground">
            {mappings === undefined
              ? 'Asking the router…'
              : enabled
                ? 'No device has opened a port right now.'
                : 'None: UPnP is off.'}
          </p>
        </CardContent>
      ) : (
        <>
          <div className="hidden border-t lg:block">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-5">App</TableHead>
                  <TableHead>Internet port</TableHead>
                  <TableHead>Device</TableHead>
                  <TableHead className="pr-5">Closes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((m) => (
                  <TableRow key={`${m.proto}-${String(m.ext_port)}`}>
                    <TableCell className="max-w-56 truncate pl-5" title={m.description}>
                      {app(m)}
                    </TableCell>
                    <TableCell>
                      {m.proto.toLowerCase()} {m.ext_port}
                    </TableCell>
                    <TableCell>
                      {m.device === undefined ? (
                        <span className="font-mono text-xs">
                          {m.int_addr}:{m.int_port}
                        </span>
                      ) : (
                        <>
                          {m.device}
                          <span className="ml-2 font-mono text-xs text-muted-foreground">
                            {m.int_addr}:{m.int_port}
                          </span>
                        </>
                      )}
                    </TableCell>
                    <TableCell className="pr-5 whitespace-normal text-muted-foreground">{expires(m)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <ul className="divide-y border-t lg:hidden">
            {rows.map((m) => (
              <li key={`${m.proto}-${String(m.ext_port)}`} className="flex flex-col gap-1 px-5 py-3">
                <span className="truncate text-sm font-medium">{app(m)}</span>
                <span className="text-xs break-all tabular">
                  {m.proto.toLowerCase()} {m.ext_port} to{' '}
                  {m.device === undefined ? (
                    <span className="font-mono">
                      {m.int_addr}:{m.int_port}
                    </span>
                  ) : (
                    <>
                      {m.device} (
                      <span className="font-mono">
                        {m.int_addr}:{m.int_port}
                      </span>
                      )
                    </>
                  )}
                </span>
                <span className="text-xs text-muted-foreground">Closes {expires(m)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

export function UpnpPage(): ReactElement {
  const { data, error, loading, reload } = useLoad(loadUpnp);
  const mappings = usePoll(getMappings, 5000);
  const [edit, setEdit] = useState<UpnpForm>();
  const onApplied = useCallback(() => {
    setEdit(undefined);
    reload();
  }, [reload]);
  const { state, apply } = useApply(onApplied);
  const form = edit ?? data ?? undefined;
  const set = <K extends keyof UpnpForm>(key: K, value: UpnpForm[K]): void => {
    setEdit((current) => {
      const base = current ?? data ?? undefined;
      return base === undefined ? undefined : { ...base, [key]: value };
    });
  };
  const dirty = edit !== undefined && JSON.stringify(edit) !== JSON.stringify(data);
  const unusual =
    form === undefined ? [] : [!form.upnp && 'UPnP IGD off', !form.natpmp && 'NAT-PMP off'].filter((x) => x !== false);

  return (
    <>
      <PageHeader title="UPnP" description="Let games and apps open ports themselves (UPnP and NAT-PMP)." />
      <div className="flex flex-col gap-4">
        <ApplyStatus state={state} />
        {error !== undefined && data === undefined ? (
          <LoadError error={error} retry={reload} />
        ) : loading && data === undefined ? (
          <FormSkeleton />
        ) : form === undefined || data === undefined || data === null ? (
          <Alert variant="warning">
            <ShieldAlertIcon />
            <AlertTitle>Not in this firmware</AlertTitle>
            <AlertDescription>
              <p>
                The miniupnpd package isn’t installed, so devices can’t open ports themselves. Open the ports a game or a console
                needs by hand instead.
              </p>
              <Button variant="outline" size="sm" className="mt-2" asChild>
                <a href={href('port-forwards')}>
                  Port forwards <ChevronRightIcon />
                </a>
              </Button>
            </AlertDescription>
          </Alert>
        ) : (
          <>
            <Answer saved={data} mappings={mappings.data} />
            <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,30rem)_minmax(0,1fr)]">
              <Card>
                <CardHeading title="Settings" />
                <CardContent className="flex flex-col">
                  <div className="divide-y border-t">
                    <Field
                      id="upnp-enabled"
                      label="Automatic port opening"
                      hint="Consoles, games and calls often work better with it on."
                    >
                      <Switch
                        id="upnp-enabled"
                        checked={form.enabled}
                        onCheckedChange={(v) => {
                          set('enabled', v);
                        }}
                      />
                    </Field>
                    <Field
                      id="upnp-secure"
                      label="Secure mode"
                      hint="A device can only open ports to itself. Keep this on."
                      why={
                        <>
                          Without it, any device on your network can open a port on your internet address to any other device, a
                          camera or a printer say. It’s miniupnpd’s <span className="font-mono">secure_mode</span> option.
                        </>
                      }
                    >
                      <Switch
                        id="upnp-secure"
                        checked={form.secure}
                        onCheckedChange={(v) => {
                          set('secure', v);
                        }}
                      />
                    </Field>
                  </div>
                  {form.enabled && !form.secure && (
                    <Note tone="warning" icon={<ShieldAlertIcon />} className="pb-3">
                      Without secure mode, any device can open ports to any other device.
                    </Note>
                  )}
                  <MoreSettings summary={unusual.length > 0 ? unusual.join(', ') : 'Both protocols on'}>
                    <Field
                      id="upnp-upnp"
                      label="UPnP IGD"
                      hint="Used by most consoles, games and apps."
                      why={
                        <>
                          The UPnP Internet Gateway Device protocol. It’s miniupnpd’s{' '}
                          <span className="font-mono">enable_upnp</span> option.
                        </>
                      }
                    >
                      <Switch
                        id="upnp-upnp"
                        checked={form.upnp}
                        onCheckedChange={(v) => {
                          set('upnp', v);
                        }}
                      />
                    </Field>
                    <Field
                      id="upnp-natpmp"
                      label="NAT-PMP / PCP"
                      hint="Used by Apple devices and some apps."
                      why={
                        <>
                          NAT Port Mapping Protocol and the Port Control Protocol that followed it. It’s miniupnpd’s{' '}
                          <span className="font-mono">enable_natpmp</span> option.
                        </>
                      }
                    >
                      <Switch
                        id="upnp-natpmp"
                        checked={form.natpmp}
                        onCheckedChange={(v) => {
                          set('natpmp', v);
                        }}
                      />
                    </Field>
                  </MoreSettings>
                </CardContent>
              </Card>
              <OpenPorts
                mappings={mappings.data}
                enabled={data.enabled}
                onClear={() => {
                  void exec('milkflint.upnp', 'clear').then(mappings.refresh);
                }}
              />
            </div>
          </>
        )}
      </div>
      <SaveBar
        visible={dirty}
        busy={state.phase === 'applying'}
        invalid={false}
        onSave={() => {
          if (form !== undefined) void apply(toChanges(form));
        }}
        onRevert={() => {
          setEdit(undefined);
        }}
      />
    </>
  );
}
