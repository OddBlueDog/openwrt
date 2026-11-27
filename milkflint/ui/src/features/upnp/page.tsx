// UPnP: letting games and apps open ports on the internet address
// themselves (miniupnpd: UPnP IGD and NAT-PMP/PCP). It opens on the answer:
// on or off, secure mode, and the ports devices have open now, which Port
// forwards lists too. Settings are upnpd.config's; the open ports come from
// the router side (milkflint.upnp), live.
import { useSuspenseQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ChevronRightIcon, EraserIcon, ShieldAlertIcon } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import { ApplyStatus } from '@/components/apply-status';
import { CardHeading } from '@/components/card-heading';
import { type Column, DataTable } from '@/components/data-table';
import { FormSaveBar, SwitchField } from '@/components/form';
import { PageHeader } from '@/components/layout/page-header';
import { MoreSettings } from '@/components/more-settings';
import { Note } from '@/components/note';
import { PageBoundary } from '@/components/page-boundary';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useApply } from '@/hooks/use-apply';
import { useFormValues, useSettingsForm } from '@/lib/form/use-settings-form';
import { formatDuration } from '@/lib/format';
import { useLive } from '@/lib/query/use-live';
import { pageLink } from '@/lib/router';
import type { Mapping } from './api';
import { toChanges, type UpnpForm, upnpFormSchema } from './model';
import { upnpQueries, useClearUpnpMappings } from './queries';

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
          <Link {...pageLink('port-forwards')} className={link}>
            Port forwards, which lists them too
            <ChevronRightIcon className="size-4" />
          </Link>
        </Cell>
      </div>
    </Card>
  );
}

const expires = (m: Mapping): string => (m.remaining === null ? 'when UPnP restarts' : `in ${formatDuration(m.remaining)}`);
const app = (m: Mapping): string => (m.description === '' ? 'No description' : m.description);

/** Each column sorts: the port as a number, a device by its name (else its address), and those that close only on a restart last. */
const portColumns: readonly Column<Mapping>[] = [
  // cut short when long, whole in its tooltip
  { label: 'App', cell: (m) => <span title={m.description}>{app(m)}</span>, sort: app, className: 'max-w-56 truncate' },
  {
    label: 'Internet port',
    cell: (m) => `${m.proto.toLowerCase()} ${String(m.ext_port)}`,
    sort: (m) => m.ext_port,
    className: 'whitespace-nowrap',
  },
  {
    label: 'Device',
    cell: (m) =>
      m.device === undefined ? (
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
      ),
    sort: (m) => m.device ?? m.int_addr,
  },
  {
    label: 'Closes',
    cell: expires,
    sort: (m) => m.remaining ?? undefined,
    sortLabel: 'Closing soonest first',
    className: 'text-muted-foreground',
  },
];

/** The ports devices opened, live, as the router lists them: a table on a wide screen, a card each on a phone. */
function OpenPorts({
  mappings,
  enabled,
  onClear,
  error,
}: {
  mappings: readonly Mapping[] | undefined;
  enabled: boolean;
  onClear: () => void;
  /** a Clear all that failed */
  error: Error | null;
}): ReactElement {
  const rows = mappings ?? [];
  return (
    <Card className="pb-0">
      <CardHeading
        title="Ports devices opened"
        description={error === null ? 'Live. To open one yourself, use Port forwards.' : `Couldn’t clear them: ${error.message}`}
        action={
          <Button variant="outline" size="sm" disabled={rows.length === 0} onClick={onClear}>
            <EraserIcon /> Clear all
          </Button>
        }
      />
      <DataTable
        label="Ports devices opened"
        columns={portColumns}
        rows={rows}
        rowKey={(m) => `${m.proto}-${String(m.ext_port)}`}
        empty={
          mappings === undefined
            ? 'Asking the router…'
            : enabled
              ? 'No device has opened a port right now.'
              : 'None: UPnP is off.'
        }
        defaultOrder="As the router lists them"
        framed={false}
        inset
        wide="md"
      />
    </Card>
  );
}

export function UpnpPage(): ReactElement {
  return (
    <>
      <PageHeader title="UPnP" description="Let games and apps open ports themselves (UPnP and NAT-PMP)." />
      <PageBoundary>
        <UpnpBody />
      </PageBoundary>
    </>
  );
}

function UpnpBody(): ReactElement {
  const { data: saved } = useSuspenseQuery(upnpQueries.settings());
  const mappings = useLive(upnpQueries.mappings());
  if (saved === null) return <NotInFirmware />;
  return <UpnpSettings saved={saved} mappings={mappings.data} />;
}

function NotInFirmware(): ReactElement {
  return (
    <Alert variant="warning">
      <ShieldAlertIcon />
      <AlertTitle>Not in this firmware</AlertTitle>
      <AlertDescription>
        <p>
          The miniupnpd package isn’t installed, so devices can’t open ports themselves. Open the ports a game or a console needs
          by hand instead.
        </p>
        <Button variant="outline" size="sm" className="mt-2" asChild>
          <Link {...pageLink('port-forwards')}>
            Port forwards <ChevronRightIcon />
          </Link>
        </Button>
      </AlertDescription>
    </Alert>
  );
}

function UpnpSettings({ saved, mappings }: { saved: UpnpForm; mappings: readonly Mapping[] | undefined }): ReactElement {
  const { state, apply } = useApply();
  const settings = useSettingsForm({ schema: upnpFormSchema, saved, onSave: (values) => apply(toChanges(values)) });
  const { form } = settings;
  const values = useFormValues(form);
  const clear = useClearUpnpMappings();
  const unusual = [!values.upnp && 'UPnP IGD off', !values.natpmp && 'NAT-PMP off'].filter((x) => x !== false);

  return (
    <>
      <div className="flex flex-col gap-4">
        <ApplyStatus state={state} />
        <Answer saved={saved} mappings={mappings} />
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,30rem)_minmax(0,1fr)]">
          <Card>
            <CardHeading title="Settings" />
            <CardContent className="flex flex-col">
              <div className="divide-y border-t">
                <form.Field name="enabled">
                  {(field) => (
                    <SwitchField
                      field={field}
                      id="upnp-enabled"
                      label="Automatic port opening"
                      hint="Consoles, games and calls often work better with it on."
                    />
                  )}
                </form.Field>
                <form.Field name="secure">
                  {(field) => (
                    <SwitchField
                      field={field}
                      id="upnp-secure"
                      label="Secure mode"
                      hint="A device can only open ports to itself. Keep this on."
                      why={
                        <>
                          Without it, any device on your network can open a port on your internet address to any other device, a
                          camera or a printer say. It’s miniupnpd’s <span className="font-mono">secure_mode</span> option.
                        </>
                      }
                    />
                  )}
                </form.Field>
              </div>
              {values.enabled && !values.secure && (
                <Note tone="warning" icon={<ShieldAlertIcon />} className="pb-3">
                  Without secure mode, any device can open ports to any other device.
                </Note>
              )}
              <MoreSettings summary={unusual.length > 0 ? unusual.join(', ') : 'Both protocols on'}>
                <form.Field name="upnp">
                  {(field) => (
                    <SwitchField
                      field={field}
                      id="upnp-upnp"
                      label="UPnP IGD"
                      hint="Used by most consoles, games and apps."
                      why={
                        <>
                          The UPnP Internet Gateway Device protocol. It’s miniupnpd’s{' '}
                          <span className="font-mono">enable_upnp</span> option.
                        </>
                      }
                    />
                  )}
                </form.Field>
                <form.Field name="natpmp">
                  {(field) => (
                    <SwitchField
                      field={field}
                      id="upnp-natpmp"
                      label="NAT-PMP / PCP"
                      hint="Used by Apple devices and some apps."
                      why={
                        <>
                          NAT Port Mapping Protocol and the Port Control Protocol that followed it. It’s miniupnpd’s{' '}
                          <span className="font-mono">enable_natpmp</span> option.
                        </>
                      }
                    />
                  )}
                </form.Field>
              </MoreSettings>
            </CardContent>
          </Card>
          <OpenPorts
            mappings={mappings}
            enabled={saved.enabled}
            onClear={() => {
              clear.mutate();
            }}
            error={clear.error}
          />
        </div>
      </div>
      <FormSaveBar settings={settings} busy={state.phase === 'applying'} />
    </>
  );
}
