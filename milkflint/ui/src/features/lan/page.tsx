// The LAN page: the router's address and the addresses it hands out, as
// saved, first; then the address and the DHCP server's switch, with the
// network size, the pool and the lease time under More settings. A save
// that moves the router warns above the save bar and asks first, then
// carries this page on to the new address.
import { type ReactElement, useCallback, useState } from 'react';
import { ApplyStatus } from '@/components/apply-status';
import { CardHeading } from '@/components/card-heading';
import { Field } from '@/components/field';
import { PageHeader } from '@/components/layout/page-header';
import { FormSkeleton, LoadError } from '@/components/page-states';
import { SaveArea } from '@/components/save-area';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useApply } from '@/hooks/use-apply';
import { useLoad } from '@/hooks/use-load';
import { prefixLength } from '@/lib/api/network';
import { bool, getConfig, str } from '@/lib/api/uci';
import { href } from '@/lib/router';
import { routerUrl } from '@/lib/router-url';
import { Answer, AnswerCell, Figure, GoLink } from '@/components/page-kit';
import { explain } from '@/components/explain';
import { MoreSettings } from '@/components/more-settings';
import {
  hostCount,
  type LanForm,
  leaseLabel,
  leaseTimes,
  moreSummary,
  moves,
  netmaskOf,
  prefixes,
  range,
  toChanges,
  validate,
} from './model';

async function loadLan(): Promise<LanForm> {
  const [network, dhcp] = await Promise.all([getConfig('network'), getConfig('dhcp')]);
  const lan = network.find((s) => s['.name'] === 'lan');
  const pool = dhcp.find((s) => s['.type'] === 'dhcp' && str(s, 'interface') === 'lan');
  const raw = str(lan, 'ipaddr') ?? '192.168.1.1';
  const [ip, cidr] = raw.split('/');
  return {
    ipaddr: ip ?? '192.168.1.1',
    prefix: String(cidr !== undefined ? Number(cidr) : prefixLength(str(lan, 'netmask'))),
    dhcp: pool !== undefined && !bool(pool, 'ignore'),
    start: str(pool, 'start') ?? '100',
    limit: str(pool, 'limit') ?? '150',
    leasetime: str(pool, 'leasetime') ?? '12h',
    cidrStyle: cidr !== undefined,
  };
}

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
        action={<GoLink href={href('clients')}>Reserve an address for a device</GoLink>}
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
  const { data, error, loading, reload } = useLoad(loadLan);
  const [edit, setEdit] = useState<LanForm>();
  const onApplied = useCallback(() => {
    setEdit(undefined);
    reload();
  }, [reload]);
  const { state, apply, applyAndMove } = useApply(onApplied);
  const form = edit ?? data;
  const errors = form === undefined ? {} : validate(form);
  // Functional update: several edits in one render can't overwrite each other.
  const set = <K extends keyof LanForm>(key: K, value: LanForm[K]): void => {
    setEdit((current) => {
      const base = current ?? data;
      return base === undefined ? undefined : { ...base, [key]: value };
    });
  };
  const dirty = edit !== undefined && JSON.stringify(edit) !== JSON.stringify(data);
  const moving = form !== undefined && data !== undefined && moves(form, data);
  const r = form === undefined ? undefined : range(form);

  const save = (): void => {
    if (form === undefined || data === undefined) return;
    if (moving) void applyAndMove(toChanges(form, data), routerUrl(form.ipaddr));
    else void apply(toChanges(form, data));
  };

  return (
    <>
      <PageHeader title="LAN" description="The router's own address, and the addresses it hands out to your devices." />
      <div className="flex flex-col gap-4">
        <ApplyStatus state={state} />
        {error !== undefined && data === undefined ? (
          <LoadError error={error} retry={reload} />
        ) : loading || form === undefined || data === undefined ? (
          <FormSkeleton />
        ) : (
          <>
            <LanAnswer saved={data} />
            <Card>
              <CardHeading
                title="Address and DHCP"
                description="A new address or network size moves the router, and this page with it."
              />
              <CardContent className="flex flex-col">
                <div className="divide-y border-t">
                  <Field
                    id="ipaddr"
                    label="Router address"
                    {...explain('Where you open this page, and your devices’ gateway.', ['network.lan.ipaddr'])}
                    error={errors.ipaddr}
                  >
                    <Input
                      id="ipaddr"
                      className="font-mono"
                      value={form.ipaddr}
                      aria-invalid={errors.ipaddr !== undefined}
                      onChange={(e) => {
                        set('ipaddr', e.target.value.trim());
                      }}
                    />
                  </Field>
                  <Field
                    id="dhcp"
                    label="DHCP server"
                    {...explain(
                      'Hands out addresses to your devices automatically. Off, each device needs a fixed address, or another DHCP server on the network.',
                      ['dhcp.lan.ignore'],
                    )}
                  >
                    <Switch
                      id="dhcp"
                      checked={form.dhcp}
                      onCheckedChange={(v) => {
                        set('dhcp', v);
                      }}
                    />
                  </Field>
                </div>
                <MoreSettings summary={moreSummary(form)}>
                  <Field
                    id="prefix"
                    label="Network size"
                    {...explain(
                      'How many addresses your network has. A larger one fits more devices; changing it moves the router like a new address does.',
                      [form.cidrStyle ? 'network.lan.ipaddr (as address/prefix)' : 'network.lan.netmask'],
                    )}
                  >
                    <Select
                      value={form.prefix}
                      onValueChange={(v) => {
                        set('prefix', v);
                      }}
                    >
                      <SelectTrigger id="prefix">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {prefixes.map((p) => (
                          <SelectItem key={p} value={p}>
                            /{p} · {netmaskOf(Number(p))} · {hostCount(Number(p)).toLocaleString('en-GB')} addresses
                          </SelectItem>
                        ))}
                        {!(prefixes as readonly string[]).includes(form.prefix) && (
                          <SelectItem value={form.prefix}>/{form.prefix}</SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                  </Field>
                  {form.dhcp && (
                    <>
                      <Field
                        id="start"
                        label="First address"
                        {...explain("Offset from the network's start. The router hands out addresses from there.", [
                          'dhcp.lan.start',
                        ])}
                        error={errors.start}
                      >
                        <Input
                          id="start"
                          inputMode="numeric"
                          className="max-w-32 tabular"
                          value={form.start}
                          aria-invalid={errors.start !== undefined}
                          onChange={(e) => {
                            set('start', e.target.value.trim());
                          }}
                        />
                      </Field>
                      <Field
                        id="limit"
                        label="How many"
                        {...explain(
                          r !== undefined && errors.start === undefined && errors.limit === undefined
                            ? `Devices get addresses from ${r.first} to ${r.last}.`
                            : 'How many addresses the router hands out.',
                          ['dhcp.lan.limit'],
                        )}
                        error={errors.limit}
                      >
                        <Input
                          id="limit"
                          inputMode="numeric"
                          className="max-w-32 tabular"
                          value={form.limit}
                          aria-invalid={errors.limit !== undefined}
                          onChange={(e) => {
                            set('limit', e.target.value.trim());
                          }}
                        />
                      </Field>
                      <Field
                        id="leasetime"
                        label="Lease time"
                        {...explain('How long a device keeps its address without checking in.', ['dhcp.lan.leasetime'])}
                      >
                        <Select
                          value={form.leasetime}
                          onValueChange={(v) => {
                            set('leasetime', v);
                          }}
                        >
                          <SelectTrigger id="leasetime">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {leaseTimes.map((t) => (
                              <SelectItem key={t.value} value={t.value}>
                                {t.label}
                              </SelectItem>
                            ))}
                            {!leaseTimes.some((t) => t.value === form.leasetime) && (
                              <SelectItem value={form.leasetime}>{form.leasetime}</SelectItem>
                            )}
                          </SelectContent>
                        </Select>
                      </Field>
                    </>
                  )}
                </MoreSettings>
              </CardContent>
            </Card>
          </>
        )}
      </div>
      <SaveArea
        visible={dirty}
        busy={state.phase === 'applying'}
        invalid={Object.keys(errors).length > 0}
        warnings={moving ? [`Afterwards it answers at ${routerUrl(form.ipaddr)}, and devices need to reconnect.`] : []}
        warningTitle="This moves the router"
        confirm={
          moving
            ? {
                title: `Move the router to ${form.ipaddr}?`,
                description:
                  'Every device loses its connection for a moment and gets a new address. This page continues at the new address. If something goes wrong, you can reach the router again by resetting it.',
                action: 'Move the router',
              }
            : undefined
        }
        onSave={save}
        onRevert={() => {
          setEdit(undefined);
        }}
      />
    </>
  );
}
