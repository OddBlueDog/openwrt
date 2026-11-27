// The LAN & DHCP page, with Settings, Addresses and Connections tabs.
// Settings: the router's address and the addresses it hands out, as saved,
// first; then the address and the DHCP server's switch, with the network
// size, the pool and the lease time under More settings. A save that moves
// the router warns above the save bar and asks first, then carries this
// page on to the new address.
import { useSuspenseQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { ApplyStatus } from '@/components/apply-status';
import { CardHeading } from '@/components/card-heading';
import { explain } from '@/components/explain';
import { SelectField, SwitchField, TextField } from '@/components/form';
import { PageHeader } from '@/components/layout/page-header';
import { MoreSettings } from '@/components/more-settings';
import { PageBoundary } from '@/components/page-boundary';
import { Answer, AnswerCell, Figure, GoLink } from '@/components/page-kit';
import { SaveArea } from '@/components/save-area';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import { useApply } from '@/hooks/use-apply';
import { formErrors } from '@/lib/form/errors';
import { useFormValues, useSettingsForm } from '@/lib/form/use-settings-form';
import { pageLink, tabFrom, tabLink, useSubPath } from '@/lib/router';
import { routerUrl } from '@/lib/router-url';
import { AddressesTab } from './addresses-tab';
import { ConnectionsTab } from './connections-tab';
import { type LanTab, lanTabs } from './leases';
import {
  hostCount,
  type LanForm,
  lanFormSchema,
  leaseLabel,
  leaseTimes,
  moreSummary,
  moves,
  netmaskOf,
  prefixes,
  range,
  toChanges,
} from './model';
import { lanQueries } from './queries';

/** The network as saved: the router's address, the addresses devices get, the network's size. */
function LanAnswer({ saved }: { saved: LanForm }): ReactElement {
  const r = range(saved);
  const prefix = Number(saved.prefix);
  return (
    <Answer columns={3} label="Your network now">
      <AnswerCell title="Router address" value={<Figure>{saved.ipaddr}</Figure>}>
        Your devices’ gateway. This page answers at{' '}
        <span className="font-mono text-xs text-foreground">{routerUrl(saved.ipaddr)}</span>
      </AnswerCell>
      <AnswerCell
        title="Addresses for devices"
        value={saved.dhcp ? <Badge variant="success">On</Badge> : <Badge variant="outline">Off</Badge>}
        action={<GoLink to={pageLink('clients')}>Reserve an address for a device</GoLink>}
      >
        {saved.dhcp ? (
          r === undefined ? (
            `${saved.limit} addresses, each kept for ${leaseLabel(saved.leasetime)}.`
          ) : (
            <>
              <span className="font-mono text-xs text-foreground">{r.first}</span> to{' '}
              <span className="font-mono text-xs text-foreground">{r.last}</span>, each kept for {leaseLabel(saved.leasetime)}.
            </>
          )
        ) : (
          'The DHCP server is off: devices need a fixed address, or another DHCP server. Turn it on below.'
        )}
      </AnswerCell>
      <AnswerCell title="Network size" value={<Figure>/{saved.prefix}</Figure>}>
        <span className="font-mono text-xs text-foreground">{netmaskOf(prefix)}</span> ·{' '}
        {hostCount(prefix).toLocaleString('en-GB')} addresses
      </AnswerCell>
    </Answer>
  );
}

export function LanPage(): ReactElement {
  const navigate = useNavigate();
  const goTo = (t: LanTab): void => {
    void navigate(tabLink('lan', t, 'settings'));
  };
  const tab = tabFrom(useSubPath(), lanTabs, 'settings');
  return (
    <>
      <PageHeader title="LAN & DHCP" description="The router's address, the addresses it hands out, and who is talking now." />
      <Tabs label="LAN & DHCP" prefix="lan" items={lanTabs} value={tab} onChange={goTo} className="mb-4" />
      <TabPanel prefix="lan" id="addresses" value={tab}>
        {/* mounted only while shown, so nothing polls on the other tabs */}
        {tab === 'addresses' && <AddressesTab />}
      </TabPanel>
      <TabPanel prefix="lan" id="connections" value={tab}>
        {tab === 'connections' && <ConnectionsTab />}
      </TabPanel>
      <TabPanel prefix="lan" id="settings" value={tab}>
        <PageBoundary>
          <LanSettings />
        </PageBoundary>
      </TabPanel>
    </>
  );
}

function LanSettings(): ReactElement {
  const { data: saved } = useSuspenseQuery(lanQueries.settings());
  const { state, apply, applyAndMove } = useApply();
  const settings = useSettingsForm({
    schema: lanFormSchema,
    saved,
    onSave: (values) =>
      moves(values, saved) ? applyAndMove(toChanges(values, saved), routerUrl(values.ipaddr)) : apply(toChanges(values, saved)),
  });
  const { form } = settings;
  const values = useFormValues(form);
  const moving = moves(values, saved);
  const r = range(values);
  const errors = formErrors(lanFormSchema, values);
  const prefixOptions = [
    ...prefixes.map((p) => ({
      value: p,
      label: `/${p} · ${netmaskOf(Number(p))} · ${hostCount(Number(p)).toLocaleString('en-GB')} addresses`,
    })),
    ...((prefixes as readonly string[]).includes(values.prefix) ? [] : [{ value: values.prefix, label: `/${values.prefix}` }]),
  ];
  const leaseOptions = [
    ...leaseTimes.map((t) => ({ value: t.value, label: t.label })),
    ...(leaseTimes.some((t) => t.value === values.leasetime) ? [] : [{ value: values.leasetime, label: values.leasetime }]),
  ];

  return (
    <>
      <div className="flex flex-col gap-4">
        <ApplyStatus state={state} />
        <LanAnswer saved={saved} />
        <Card>
          <CardHeading
            title="Address and DHCP"
            description="A new address or network size moves the router, and this page with it."
          />
          <CardContent className="flex flex-col">
            <div className="divide-y border-t">
              <form.Field name="ipaddr">
                {(field) => (
                  <TextField
                    field={field}
                    id="ipaddr"
                    label="Router address"
                    {...explain('Where you open this page, and your devices’ gateway.', ['network.lan.ipaddr'])}
                    className="font-mono"
                    trim
                  />
                )}
              </form.Field>
              <form.Field name="dhcp">
                {(field) => (
                  <SwitchField
                    field={field}
                    id="dhcp"
                    label="DHCP server"
                    {...explain(
                      'Hands out addresses to your devices automatically. Off, each device needs a fixed address, or another DHCP server on the network.',
                      ['dhcp.lan.ignore'],
                    )}
                  />
                )}
              </form.Field>
            </div>
            <MoreSettings summary={moreSummary(values)}>
              <form.Field name="prefix">
                {(field) => (
                  <SelectField
                    field={field}
                    id="prefix"
                    label="Network size"
                    {...explain(
                      'How many addresses your network has. A larger one fits more devices; changing it moves the router like a new address does.',
                      [values.cidrStyle ? 'network.lan.ipaddr (as address/prefix)' : 'network.lan.netmask'],
                    )}
                    options={prefixOptions}
                  />
                )}
              </form.Field>
              {values.dhcp && (
                <>
                  <form.Field name="start">
                    {(field) => (
                      <TextField
                        field={field}
                        id="start"
                        label="First address"
                        {...explain("Offset from the network's start. The router hands out addresses from there.", [
                          'dhcp.lan.start',
                        ])}
                        inputMode="numeric"
                        className="max-w-32 tabular"
                        trim
                      />
                    )}
                  </form.Field>
                  <form.Field name="limit">
                    {(field) => (
                      <TextField
                        field={field}
                        id="limit"
                        label="How many"
                        {...explain(
                          r !== undefined && errors['start'] === undefined && errors['limit'] === undefined
                            ? `Devices get addresses from ${r.first} to ${r.last}.`
                            : 'How many addresses the router hands out.',
                          ['dhcp.lan.limit'],
                        )}
                        inputMode="numeric"
                        className="max-w-32 tabular"
                        trim
                      />
                    )}
                  </form.Field>
                  <form.Field name="leasetime">
                    {(field) => (
                      <SelectField
                        field={field}
                        id="leasetime"
                        label="Lease time"
                        {...explain('How long a device keeps its address without checking in.', ['dhcp.lan.leasetime'])}
                        options={leaseOptions}
                      />
                    )}
                  </form.Field>
                </>
              )}
            </MoreSettings>
          </CardContent>
        </Card>
      </div>
      <SaveArea
        visible={settings.dirty}
        busy={state.phase === 'applying'}
        invalid={settings.invalid}
        warnings={moving ? [`Afterwards it answers at ${routerUrl(values.ipaddr)}, and devices need to reconnect.`] : []}
        warningTitle="This moves the router"
        confirm={
          moving
            ? {
                title: `Move the router to ${values.ipaddr}?`,
                description:
                  'Every device loses its connection for a moment and gets a new address. This page continues at the new address. If something goes wrong, you can reach the router again by resetting it.',
                action: 'Move the router',
              }
            : undefined
        }
        onSave={settings.save}
        onRevert={settings.discard}
      />
    </>
  );
}
