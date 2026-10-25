import { ChevronRightIcon, EraserIcon, InfoIcon, PlugZapIcon, ShieldAlertIcon } from 'lucide-react';
import { type ReactElement, useCallback, useState } from 'react';
import { z } from 'zod';
import { ApplyStatus } from '@/components/apply-status';
import { CardHeading } from '@/components/card-heading';
import { Field } from '@/components/field';
import { PageHeader } from '@/components/layout/page-header';
import { FormSkeleton, LoadError } from '@/components/page-states';
import { SaveBar } from '@/components/save-bar';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
import { call, exec } from '@/lib/ubus';

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

  const toChanges = (f: UpnpForm): Change[] => [
    {
      op: 'set',
      config: 'upnpd',
      section: 'config',
      values: { enabled: f.enabled ? '1' : '0', enable_upnp: f.upnp ? '1' : '0', enable_natpmp: f.natpmp ? '1' : '0', secure_mode: f.secure ? '1' : '0' },
    },
  ];

  return (
    <>
      <PageHeader title="UPnP" description="Let games and apps open ports themselves (UPnP and NAT-PMP)." />
      <div className="flex flex-col gap-4">
        <ApplyStatus state={state} />
        {error !== undefined && data === undefined ? (
          <LoadError error={error} retry={reload} />
        ) : loading && data === undefined ? (
          <FormSkeleton />
        ) : form === undefined ? (
          <Alert variant="warning">
            <AlertTitle>Not available</AlertTitle>
            <AlertDescription>The miniupnpd package isn&apos;t in this firmware.</AlertDescription>
          </Alert>
        ) : (
          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,28rem)_1fr]">
            <Card>
              <CardHeading
                icon={PlugZapIcon}
                title="Automatic port opening"
                description="Consoles, games and calls often work better with it on."
                action={
                  <Switch
                    checked={form.enabled}
                    onCheckedChange={(v) => {
                      set('enabled', v);
                    }}
                    aria-label="UPnP on"
                  />
                }
              />
              <CardContent className="flex flex-col gap-3">
                <Alert variant="info">
                  <InfoIcon />
                  <AlertDescription>
                    When it&apos;s on, devices on your network can open ports on your internet address to themselves for a while,
                    so you don&apos;t need to set up port forwarding. The router closes each port when the device lets go of it or
                    its time runs out.
                  </AlertDescription>
                </Alert>
                {form.enabled && (
                  <details className="group rounded-lg border px-4 [&[open]]:pb-1">
                    <summary className="flex cursor-pointer list-none items-center gap-1.5 py-3 text-sm font-medium text-muted-foreground select-none hover:text-foreground [&::-webkit-details-marker]:hidden">
                      <ChevronRightIcon className="size-4 transition-transform group-open:rotate-90" />
                      Advanced options
                    </summary>
                    <div className="divide-y border-t">
                      <Field id="upnp-upnp" label="UPnP IGD" hint="Used by most consoles, games and apps.">
                        <Switch
                          id="upnp-upnp"
                          checked={form.upnp}
                          onCheckedChange={(v) => {
                            set('upnp', v);
                          }}
                        />
                      </Field>
                      <Field id="upnp-natpmp" label="NAT-PMP / PCP" hint="Used by Apple devices and some apps.">
                        <Switch
                          id="upnp-natpmp"
                          checked={form.natpmp}
                          onCheckedChange={(v) => {
                            set('natpmp', v);
                          }}
                        />
                      </Field>
                      <Field id="upnp-secure" label="Secure mode" hint="A device can only open ports to itself. Keep this on.">
                        <Switch
                          id="upnp-secure"
                          checked={form.secure}
                          onCheckedChange={(v) => {
                            set('secure', v);
                          }}
                        />
                      </Field>
                    </div>
                  </details>
                )}
                {form.enabled && !form.secure && (
                  <Alert variant="warning">
                    <ShieldAlertIcon />
                    <AlertDescription>Without secure mode, any device can open ports to any other device.</AlertDescription>
                  </Alert>
                )}
              </CardContent>
            </Card>

            <Card className="pb-0">
              <CardHeading
                icon={PlugZapIcon}
                title="Open ports"
                description="Opened by devices, live"
                action={
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={(mappings.data?.length ?? 0) === 0}
                    onClick={() => {
                      void exec('milkflint.upnp', 'clear').then(mappings.refresh);
                    }}
                  >
                    <EraserIcon /> Clear all
                  </Button>
                }
              />
              <CardContent className="px-0">
                {(mappings.data?.length ?? 0) === 0 ? (
                  <p className="px-5 pb-5 text-sm text-muted-foreground">
                    {data?.enabled === true ? 'No device has opened a port.' : 'UPnP is off.'}
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead>App</TableHead>
                        <TableHead>Internet port</TableHead>
                        <TableHead>Device</TableHead>
                        <TableHead>Expires</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {mappings.data?.map((m) => (
                        <TableRow key={`${m.proto}-${String(m.ext_port)}`}>
                          <TableCell>{m.description === '' ? '—' : m.description}</TableCell>
                          <TableCell className="font-mono">
                            {m.ext_port} {m.proto}
                          </TableCell>
                          <TableCell>
                            {m.device ?? m.int_addr}
                            <span className="ml-2 font-mono text-xs text-muted-foreground">
                              {m.device === undefined ? '' : m.int_addr}:{m.int_port}
                            </span>
                          </TableCell>
                          <TableCell className="text-muted-foreground">{m.remaining === null ? 'never' : `in ${formatDuration(m.remaining)}`}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>
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
