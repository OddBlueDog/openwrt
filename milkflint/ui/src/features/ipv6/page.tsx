// The IPv6 page: whether IPv6 works now (wan6, the router's address, the
// prefixes, live every 10 s) and how it's set, then the mode, how devices
// get their addresses and, under More settings, the local (ULA) prefix.
import { useSuspenseQuery } from '@tanstack/react-query';
import { ChevronDownIcon } from 'lucide-react';
import { type ReactElement, type ReactNode, useId, useState } from 'react';
import { ApplyStatus } from '@/components/apply-status';
import { CardHeading } from '@/components/card-heading';
import { explain } from '@/components/explain';
import { FormSaveBar, SelectField, TextField } from '@/components/form';
import { PageHeader } from '@/components/layout/page-header';
import { MoreSettings } from '@/components/more-settings';
import { PageBoundary } from '@/components/page-boundary';
import { Answer, AnswerCell, ChoiceCards, GoLink } from '@/components/page-kit';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { useApply } from '@/hooks/use-apply';
import { useFormValues, useSettingsForm } from '@/lib/form/use-settings-form';
import { useLive } from '@/lib/query/use-live';
import { pageLink } from '@/lib/router';
import { cn } from '@/lib/utils';
import { addressing, type Ipv6Form, ipv6FormSchema, type Mode, modes, toChanges } from './model';
import { ipv6Queries } from './queries';

const fmt = (a: { address: string; mask: number } | undefined): string | undefined =>
  a === undefined ? undefined : `${a.address}/${String(a.mask)}`;

/** An address in mono that wraps anywhere, or a dash. */
function Addr({ value, className }: { value: string | undefined; className?: string }): ReactElement {
  return (
    <span className={cn('font-mono break-all', value === undefined ? 'text-muted-foreground' : 'text-foreground', className)}>
      {value ?? '—'}
    </span>
  );
}

/** IPv6 now: the internet side (wan6, live every 10 s), the prefixes, and what devices get as saved. */
function Ipv6Answer({ saved }: { saved: Ipv6Form | undefined }): ReactElement {
  const { data: ifaces, error } = useLive(ipv6Queries.interfaces());
  const wan6 = ifaces?.find((i) => i.interface === 'wan6');
  const lan = ifaces?.find((i) => i.interface === 'lan');
  const addr = fmt(wan6?.['ipv6-address']?.[0]);
  const prefix = fmt(wan6?.['ipv6-prefix']?.[0]);
  const lanPrefix = fmt(lan?.['ipv6-prefix-assignment']?.[0]);
  const dns = wan6?.['dns-server'] ?? [];
  const off = saved?.mode === 'off';

  const state =
    ifaces === undefined ? (
      <span className="text-sm text-muted-foreground">{error === undefined ? 'Reading…' : 'Couldn’t read it'}</span>
    ) : wan6 === undefined ? (
      <Badge variant="outline">Not set up</Badge>
    ) : wan6.up ? (
      <Badge variant="success">Connected</Badge>
    ) : off ? (
      <Badge variant="outline">Off</Badge>
    ) : (
      <Badge variant="destructive">Not connected</Badge>
    );

  return (
    <Answer columns={3} label="IPv6 now">
      <AnswerCell
        title="IPv6 from your provider"
        value={state}
        {...(wan6?.up !== true && !off && ifaces !== undefined
          ? { action: <GoLink to={pageLink('internet')}>Internet connection</GoLink> }
          : {})}
      >
        {wan6?.up === true ? (
          <span className="flex flex-col gap-0.5">
            <span>
              Router <Addr value={addr} className="text-xs" />
            </span>
            <span>
              DNS <Addr value={dns.length > 0 ? dns.join(', ') : undefined} className="text-xs" />
            </span>
          </span>
        ) : off || wan6 === undefined ? (
          'The router doesn’t ask your provider for IPv6. Choose Native or Pass-through below to turn it on.'
        ) : (
          'No answer from your provider yet. Check that your plan includes IPv6, and that the internet connection is up.'
        )}
      </AnswerCell>
      <AnswerCell
        title="Your network’s prefix"
        value={
          lanPrefix === undefined ? (
            <Badge variant="outline">None</Badge>
          ) : prefix === undefined ? (
            <Badge variant="info">Local only</Badge>
          ) : (
            <Badge variant="success">From your provider</Badge>
          )
        }
      >
        {lanPrefix === undefined ? (
          saved?.mode === 'relay' ? (
            'None of its own: with pass-through, devices take addresses from your provider’s network.'
          ) : off ? (
            'None while IPv6 is off.'
          ) : (
            'None yet.'
          )
        ) : (
          <span className="flex flex-col gap-0.5">
            <Addr value={lanPrefix} className="text-xs" />
            <span>
              {prefix === undefined ? (
                'Your provider delegated none, so devices have local addresses only.'
              ) : (
                <>
                  Delegated: <Addr value={prefix} className="text-xs" />
                </>
              )}
            </span>
          </span>
        )}
      </AnswerCell>
      <AnswerCell
        title="Your devices"
        value={
          <span className="text-xl font-semibold tracking-tight">
            {saved === undefined ? '—' : saved.mode === 'native' ? addressing[saved.addressing].label : modes[saved.mode].label}
          </span>
        }
      >
        {saved === undefined
          ? 'Reading the settings…'
          : saved.mode === 'native'
            ? addressing[saved.addressing].hint
            : modes[saved.mode].hint}
      </AnswerCell>
    </Answer>
  );
}

/** "Why?" under a choice that isn't a Field: the mechanism and the UCI options, folded. */
function ChoiceWhy({ lead, why }: { lead: string; why: ReactNode }): ReactElement {
  const [open, setOpen] = useState(false);
  const panel = useId();
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs text-muted-foreground">
        {lead}{' '}
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panel}
          onClick={() => {
            setOpen((o) => !o);
          }}
          className="inline-flex cursor-pointer items-center gap-0.5 rounded-sm font-medium link"
        >
          Why?
          <ChevronDownIcon className={cn('size-3 transition-transform duration-fast', open && 'rotate-180')} />
        </button>
      </p>
      <div id={panel} hidden={!open} className="max-w-prose rounded-md bg-muted px-3 py-2 text-xs text-foreground">
        {why}
      </div>
    </div>
  );
}

export function Ipv6Page(): ReactElement {
  return (
    <>
      <PageHeader title="IPv6" description="IPv6 from your provider, and how devices get their addresses." />
      <PageBoundary>
        <Ipv6Body />
      </PageBoundary>
    </>
  );
}

function Ipv6Body(): ReactElement {
  const { data } = useSuspenseQuery(ipv6Queries.settings());
  const { state, apply } = useApply();
  const settings = useSettingsForm({
    schema: ipv6FormSchema,
    saved: data.form,
    onSave: (values) => apply(toChanges(values, data)),
  });
  const { form } = settings;
  const values = useFormValues(form);
  const modeWhy = explain(
    'Native asks your provider for a prefix (DHCPv6-PD) and runs the router’s own IPv6 server for your devices. Pass-through relays your provider’s router adverts, DHCPv6 and neighbour discovery between the WAN and your network instead.',
    ['network.wan6.disabled', 'dhcp.lan.ra', 'dhcp.lan.dhcpv6', 'dhcp.lan.ndp', 'dhcp.wan6'],
  );

  return (
    <>
      <div className="flex flex-col gap-4">
        <ApplyStatus state={state} />
        <Ipv6Answer saved={data.form} />
        <Card>
          <CardHeading
            title="IPv6 settings"
            description="What the router asks your provider for, and what it passes on to your devices."
          />
          <CardContent className="flex flex-col">
            <div className="flex flex-col gap-3 pb-5">
              <form.Field name="mode">
                {(field) => (
                  <ChoiceCards
                    label="IPv6 mode"
                    columns={3}
                    value={field.state.value}
                    options={(Object.keys(modes) as Mode[]).map((m) => ({
                      value: m,
                      label: modes[m].label,
                      hint: modes[m].hint,
                    }))}
                    onChange={(m) => {
                      field.handleChange(m);
                    }}
                  />
                )}
              </form.Field>
              <ChoiceWhy lead="What each mode sets up." why={modeWhy.why} />
            </div>
            {values.mode === 'native' && (
              <div className="divide-y border-t">
                <form.Field name="addressing">
                  {(field) => (
                    <SelectField
                      field={field}
                      id="v6-addr"
                      label="Device addresses"
                      {...explain(
                        `${addressing[values.addressing].hint} SLAAC: devices make addresses from the router’s adverts; DHCPv6: they ask the router for one.`,
                        ['dhcp.lan.ra_slaac', 'dhcp.lan.dhcpv6', 'dhcp.lan.ra_flags'],
                      )}
                      options={(['slaac', 'both', 'dhcpv6'] as const).map((k) => ({ value: k, label: addressing[k].label }))}
                    />
                  )}
                </form.Field>
              </div>
            )}
            {values.mode !== 'off' && (
              <MoreSettings summary={values.ula === '' ? 'Local prefix: none' : `Local prefix ${values.ula}`}>
                <form.Field name="ula">
                  {(field) => (
                    <TextField
                      field={field}
                      id="v6-ula"
                      label="Local prefix (ULA)"
                      {...explain(
                        "Private IPv6 addresses that keep working if your provider's prefix changes. They work only inside your network.",
                        ['network.globals.ula_prefix'],
                      )}
                      className="font-mono"
                      trim
                    />
                  )}
                </form.Field>
              </MoreSettings>
            )}
          </CardContent>
        </Card>
      </div>
      <FormSaveBar settings={settings} busy={state.phase === 'applying'} />
    </>
  );
}
