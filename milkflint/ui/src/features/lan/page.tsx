import { NetworkIcon, ServerIcon, TriangleAlertIcon } from 'lucide-react';
import { type ReactElement, useCallback, useState } from 'react';
import { ApplyStatus } from '@/components/apply-status';
import { Field } from '@/components/field';
import { PageHeader } from '@/components/layout/page-header';
import { FormSkeleton, LoadError } from '@/components/page-states';
import { SaveBar } from '@/components/save-bar';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Switch } from '@/components/ui/switch';
import { useApply } from '@/hooks/use-apply';
import { useLoad } from '@/hooks/use-load';
import { intToIp, ipToInt, prefixLength } from '@/lib/api/network';
import { bool, type Change, getConfig, str } from '@/lib/api/uci';
import { href } from '@/lib/router';

const prefixes = ['24', '23', '22', '16'] as const;
const leaseTimes = [
  { value: '1h', label: '1 hour' },
  { value: '12h', label: '12 hours' },
  { value: '24h', label: '1 day' },
  { value: '7d', label: '1 week' },
] as const;

interface LanForm {
  ipaddr: string;
  prefix: string;
  dhcp: boolean;
  start: string;
  limit: string;
  leasetime: string;
  cidrStyle: boolean;
}

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

function netmaskOf(prefix: number): string {
  return intToIp(prefix === 0 ? 0 : (2 ** 32 - 2 ** (32 - prefix)) >>> 0);
}

/** First and last address the DHCP server hands out. */
function range(f: LanForm): { first: string; last: string } | undefined {
  const ip = ipToInt(f.ipaddr);
  const start = Number(f.start);
  const limit = Number(f.limit);
  if (ip === undefined || !Number.isInteger(start) || !Number.isInteger(limit)) return undefined;
  const size = 2 ** (32 - Number(f.prefix));
  const base = Math.floor(ip / size) * size;
  return { first: intToIp(base + start), last: intToIp(base + start + limit - 1) };
}

function validate(f: LanForm): Partial<Record<keyof LanForm, string>> {
  const e: Partial<Record<keyof LanForm, string>> = {};
  const ip = ipToInt(f.ipaddr);
  const size = 2 ** (32 - Number(f.prefix));
  if (ip === undefined) e.ipaddr = 'Enter an IPv4 address, e.g. 192.168.1.1.';
  else {
    const host = ip % size;
    const first = Math.floor(ip / 16777216);
    const second = Math.floor(ip / 65536) % 256;
    const isPrivate = first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);
    if (!isPrivate) e.ipaddr = 'Use a private address (10.x, 172.16–31.x or 192.168.x).';
    else if (host === 0 || host === size - 1) e.ipaddr = 'That’s the network or broadcast address, not usable by the router.';
  }
  const start = Number(f.start);
  const limit = Number(f.limit);
  if (!Number.isInteger(start) || start < 1 || start >= size - 1) e.start = `Use 1 to ${String(size - 2)}.`;
  if (!Number.isInteger(limit) || limit < 1 || start + limit > size - 1) e.limit = 'The range would run past the end of the network.';
  return e;
}

function toChanges(f: LanForm, before: LanForm): Change[] {
  const changes: Change[] = [];
  if (f.ipaddr !== before.ipaddr || f.prefix !== before.prefix) {
    changes.push(
      f.cidrStyle
        ? { op: 'set', config: 'network', section: 'lan', values: { ipaddr: `${f.ipaddr}/${f.prefix}` } }
        : { op: 'set', config: 'network', section: 'lan', values: { ipaddr: f.ipaddr, netmask: netmaskOf(Number(f.prefix)) } },
    );
  }
  changes.push({
    op: 'set',
    config: 'dhcp',
    section: 'lan',
    values: { ignore: f.dhcp ? '0' : '1', start: f.start, limit: f.limit, leasetime: f.leasetime },
  });
  return changes;
}

export function LanPage(): ReactElement {
  const { data, error, loading, reload } = useLoad(loadLan);
  const [edit, setEdit] = useState<LanForm>();
  const [confirmMove, setConfirmMove] = useState(false);
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
  const moving = form !== undefined && data !== undefined && (form.ipaddr !== data.ipaddr || form.prefix !== data.prefix);
  const r = form === undefined ? undefined : range(form);

  const save = (): void => {
    if (form === undefined || data === undefined) return;
    if (moving) setConfirmMove(true);
    else void apply(toChanges(form, data));
  };

  return (
    <>
      <PageHeader title="LAN" description="The router's own address, and the addresses it hands out to your devices." />
      <div className="flex flex-col gap-4">
        <ApplyStatus state={state} />
        {error !== undefined && data === undefined ? (
          <LoadError error={error} retry={reload} />
        ) : loading || form === undefined ? (
          <FormSkeleton />
        ) : (
          <div className="grid items-start gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader className="items-center">
                <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <NetworkIcon className="size-4" />
                </div>
                <div className="flex flex-col gap-1">
                  <CardTitle className="text-base">Router address</CardTitle>
                  <CardDescription>Where you open this page, and your devices&apos; gateway.</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="divide-y">
                <Field id="ipaddr" label="IP address" error={errors.ipaddr}>
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
                <Field id="prefix" label="Network size">
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
                          /{p} · {netmaskOf(Number(p))} · {(2 ** (32 - Number(p)) - 2).toLocaleString('en-GB')} addresses
                        </SelectItem>
                      ))}
                      {!(prefixes as readonly string[]).includes(form.prefix) && (
                        <SelectItem value={form.prefix}>/{form.prefix}</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </Field>
                {moving && (
                  <div className="pt-3">
                    <Alert variant="warning">
                      <TriangleAlertIcon />
                      <AlertTitle>This moves the router</AlertTitle>
                      <AlertDescription>
                        Afterwards it answers at http://{form.ipaddr}/, and devices need to reconnect. It can&apos;t be
                        undone automatically.
                      </AlertDescription>
                    </Alert>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="items-center">
                <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <ServerIcon className="size-4" />
                </div>
                <div className="flex flex-col gap-1">
                  <CardTitle className="text-base">DHCP server</CardTitle>
                  <CardDescription>
                    Hands out addresses automatically.{' '}
                    <a href={href('clients')} className="text-primary hover:underline">
                      Reserve an address for a device
                    </a>
                  </CardDescription>
                </div>
                <Switch
                  className="ml-auto"
                  checked={form.dhcp}
                  onCheckedChange={(v) => {
                    set('dhcp', v);
                  }}
                  aria-label="DHCP server on"
                />
              </CardHeader>
              {form.dhcp && (
                <CardContent className="divide-y">
                  <Field id="start" label="First address" hint="Offset from the network's start." error={errors.start}>
                    <Input
                      id="start"
                      inputMode="numeric"
                      className="font-mono"
                      value={form.start}
                      aria-invalid={errors.start !== undefined}
                      onChange={(e) => {
                        set('start', e.target.value.trim());
                      }}
                    />
                  </Field>
                  <Field id="limit" label="How many" error={errors.limit}>
                    <Input
                      id="limit"
                      inputMode="numeric"
                      className="font-mono"
                      value={form.limit}
                      aria-invalid={errors.limit !== undefined}
                      onChange={(e) => {
                        set('limit', e.target.value.trim());
                      }}
                    />
                  </Field>
                  {r !== undefined && errors.start === undefined && errors.limit === undefined && (
                    <p className="py-3 text-sm text-muted-foreground">
                      Devices get addresses from <span className="font-mono text-foreground">{r.first}</span> to{' '}
                      <span className="font-mono text-foreground">{r.last}</span>.
                    </p>
                  )}
                  <Field id="leasetime" label="Lease time" hint="How long a device keeps its address without checking in.">
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
                </CardContent>
              )}
            </Card>
          </div>
        )}
      </div>
      <SaveBar
        visible={dirty}
        busy={state.phase === 'applying'}
        invalid={Object.keys(errors).length > 0}
        onSave={save}
        onRevert={() => {
          setEdit(undefined);
        }}
      />
      <Dialog open={confirmMove} onOpenChange={setConfirmMove}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move the router to {form?.ipaddr}?</DialogTitle>
            <DialogDescription>
              Every device loses its connection for a moment and gets a new address. This page continues at the new
              address. If something goes wrong, you can reach the router again by resetting it.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setConfirmMove(false);
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                setConfirmMove(false);
                if (form !== undefined && data !== undefined) {
                  void applyAndMove(toChanges(form, data), `http://${form.ipaddr}/`);
                }
              }}
            >
              Move the router
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
