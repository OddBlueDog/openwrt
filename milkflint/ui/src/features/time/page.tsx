// Name & time: the router's clock, live, with whether it agrees with this
// device, then the small form for its name, time zone and internet time.
// The clock ticks in the browser from offsets read every 30 s.
import { CheckCircle2Icon, Clock3Icon, LoaderCircleIcon, TriangleAlertIcon } from 'lucide-react';
import { type ReactElement, type ReactNode, useCallback, useEffect, useState } from 'react';
import { ApplyStatus } from '@/components/apply-status';
import { CardHeading } from '@/components/card-heading';
import { Field } from '@/components/field';
import { PageHeader } from '@/components/layout/page-header';
import { Note } from '@/components/note';
import { FormSkeleton, LoadError } from '@/components/page-states';
import { SaveBar } from '@/components/save-bar';
import { SearchSelect } from '@/components/search-select';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useApply } from '@/hooks/use-apply';
import { useLoad } from '@/hooks/use-load';
import { usePoll } from '@/hooks/use-poll';
import { getInfo, getTimezones, getUnixtime, setLocaltime } from '@/lib/api/system';
import { bool, type Change, getConfig, list, str } from '@/lib/api/uci';
import { href } from '@/lib/router';
import { errorMessage } from '@/lib/utils';
import { explain } from '@/components/explain';
import { withUtc, zoneChosen } from './zone';

interface TimeForm {
  section: string;
  hostname: string;
  /** '' until a time zone is picked (./zone.ts): the router stays on UTC */
  zonename: string;
  ntp: boolean;
  servers: string;
}

interface TimeData {
  form: TimeForm;
  zones: { name: string; tz: string }[];
  ntpSection: string | undefined;
}

async function loadTime(): Promise<TimeData> {
  const [system, zones] = await Promise.all([getConfig('system'), getTimezones().catch(() => [])]);
  const s = system.find((x) => x['.type'] === 'system');
  const ntp = system.find((x) => x['.type'] === 'timeserver');
  return {
    form: {
      section: s?.['.name'] ?? 'system',
      hostname: str(s, 'hostname') ?? 'MilkFlint',
      zonename: zoneChosen(s) ? (str(s, 'zonename') ?? 'UTC') : '',
      ntp: ntp === undefined ? false : bool(ntp, 'enabled', true),
      servers: list(ntp, 'server').join('\n'),
    },
    zones: withUtc(zones),
    ntpSection: ntp?.['.name'],
  };
}

const HOSTNAME = /^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
const SERVER = /^[A-Za-z0-9.-]+$/;

function serversOf(text: string): string[] {
  return text.split(/[\s,]+/).filter((s) => s !== '');
}

interface ClockOffsets {
  /** Router clock minus this device's clock (ms): real drift. */
  drift: number;
  /** The router's time zone offset from UTC right now (ms). */
  zone: number;
}

async function clockOffsets(): Promise<ClockOffsets> {
  const [info, unix] = await Promise.all([getInfo(), getUnixtime()]);
  return { drift: unix * 1000 - Date.now(), zone: (info.localtime - unix) * 1000 };
}

/** A fact beside the clock: its label above, its value below. */
function Fact({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="truncate text-sm font-medium">{children}</dd>
    </div>
  );
}

/** The answer: the router's clock ticking, whether it agrees with this device, and what it's set to. */
function RouterClock({ saved }: { saved: TimeForm | undefined }): ReactElement {
  const polled = usePoll(clockOffsets, 30_000);
  const [synced, setSynced] = useState(false);
  const drift = synced ? 0 : polled.data?.drift;
  const zone = polled.data?.zone;
  const [now, setNow] = useState(() => Date.now());
  const [syncing, setSyncing] = useState<string>();

  useEffect(() => {
    const t = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(t);
    };
  }, []);

  const sync = async (): Promise<void> => {
    setSyncing('busy');
    try {
      await setLocaltime(Math.floor(Date.now() / 1000));
      setSynced(true);
      setSyncing(undefined);
    } catch (err) {
      setSyncing(errorMessage(err));
    }
  };

  const shown = drift === undefined || zone === undefined ? undefined : new Date(now + drift + zone);
  const off = drift !== undefined && Math.abs(drift) > 60_000;
  return (
    <Card className="gap-0 py-0">
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4 p-5">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="text-sm text-muted-foreground">Router time</h2>
          <p className="text-3xl font-semibold tracking-tight tabular">
            {shown === undefined
              ? '—'
              : shown.toLocaleTimeString('en-GB', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </p>
          <p className="text-sm text-muted-foreground">
            {shown === undefined
              ? 'Reading the router’s clock…'
              : shown.toLocaleDateString('en-GB', {
                  timeZone: 'UTC',
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })}
          </p>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          {drift !== undefined &&
            (off ? (
              <Note tone="warning" icon={<TriangleAlertIcon />}>
                About {Math.round(Math.abs(drift) / 60_000)} min {drift > 0 ? 'ahead of' : 'behind'} this device
              </Note>
            ) : (
              <Note tone="success" icon={<CheckCircle2Icon />}>
                In step with this device
              </Note>
            ))}
          <Button variant={off ? 'default' : 'outline'} size="sm" onClick={() => void sync()} disabled={syncing === 'busy'}>
            {syncing === 'busy' ? <LoaderCircleIcon className="animate-spin" /> : <Clock3Icon />}
            Set from this device
          </Button>
          {syncing !== undefined && syncing !== 'busy' && (
            <p role="alert" className="text-xs text-destructive">
              {syncing}
            </p>
          )}
        </div>
      </div>
      {saved !== undefined && (
        <dl className="grid gap-4 border-t px-5 py-4 sm:grid-cols-3">
          <Fact label="Name">{saved.hostname}</Fact>
          <Fact label="Time zone">{saved.zonename === '' ? 'Not chosen: UTC' : saved.zonename.replaceAll('_', ' ')}</Fact>
          <Fact label="Internet time">
            {saved.ntp
              ? `On, ${String(serversOf(saved.servers).length)} server${serversOf(saved.servers).length === 1 ? '' : 's'}`
              : 'Off'}
          </Fact>
        </dl>
      )}
    </Card>
  );
}

export function TimePage(): ReactElement {
  const { data, error, loading, reload } = useLoad(loadTime);
  const [edit, setEdit] = useState<TimeForm>();
  const onApplied = useCallback(() => {
    setEdit(undefined);
    reload();
  }, [reload]);
  const { state, apply } = useApply(onApplied);
  const form = edit ?? data?.form;
  const set = <K extends keyof TimeForm>(key: K, value: TimeForm[K]): void => {
    setEdit((current) => {
      const base = current ?? data?.form;
      return base === undefined ? undefined : { ...base, [key]: value };
    });
  };

  const errors: Partial<Record<keyof TimeForm, string>> = {};
  if (form !== undefined && !HOSTNAME.test(form.hostname))
    errors.hostname = 'Letters, digits and hyphens, not starting or ending with a hyphen.';
  if (form?.ntp === true && (serversOf(form.servers).length === 0 || !serversOf(form.servers).every((s) => SERVER.test(s)))) {
    errors.servers = 'One server name per line, e.g. 0.openwrt.pool.ntp.org.';
  }
  const dirty = edit !== undefined && JSON.stringify(edit) !== JSON.stringify(data?.form);

  const toChanges = (f: TimeForm): Change[] => {
    // the zone only when it changed: its rule comes from the list, which may not have loaded
    const zone =
      f.zonename === data?.form.zonename
        ? {}
        : { zonename: f.zonename, timezone: data?.zones.find((z) => z.name === f.zonename)?.tz ?? 'UTC0' };
    const changes: Change[] = [{ op: 'set', config: 'system', section: f.section, values: { hostname: f.hostname, ...zone } }];
    const ntp = { enabled: f.ntp ? '1' : '0', server: serversOf(f.servers) };
    changes.push(
      data?.ntpSection === undefined
        ? { op: 'add', config: 'system', type: 'timeserver', name: 'ntp', values: ntp }
        : { op: 'set', config: 'system', section: data.ntpSection, values: ntp },
    );
    return changes;
  };

  return (
    <>
      <PageHeader
        title="Name & time"
        description="The router’s name, time zone and clock. Scheduled tasks and the logs go by this clock."
      />
      <div className="flex flex-col gap-4">
        <ApplyStatus state={state} />
        <RouterClock saved={data?.form} />
        {error !== undefined && data === undefined ? (
          <LoadError error={error} retry={reload} />
        ) : loading || form === undefined || data === undefined ? (
          <FormSkeleton />
        ) : (
          <Card>
            <CardHeading title="Settings" />
            <CardContent className="divide-y">
              <Field
                id="hostname"
                label="Router name"
                {...explain('Shown on this page and to devices on your network. Letters, digits and hyphens.', [
                  'system.@system[0].hostname',
                ])}
                error={errors.hostname}
              >
                <Input
                  id="hostname"
                  value={form.hostname}
                  aria-invalid={errors.hostname !== undefined}
                  aria-describedby={errors.hostname === undefined ? undefined : 'hostname-error'}
                  onChange={(e) => {
                    set('hostname', e.target.value.trim());
                  }}
                />
              </Field>
              <Field
                id="zonename"
                label="Time zone"
                {...explain(
                  'Search by city or region, or by an abbreviation like GMT or CET. The zone’s name and its rule (such as GMT0BST,M3.5.0/1,M10.5.0) are written together, as LuCI writes them.',
                  ['system.@system[0].zonename', 'system.@system[0].timezone'],
                )}
              >
                <SearchSelect
                  id="zonename"
                  placeholder="Choose a time zone"
                  options={(data.zones.length > 0 || form.zonename === '' ? data.zones : [{ name: form.zonename, tz: '' }]).map(
                    (z) => ({
                      value: z.name,
                      label: z.name.replaceAll('_', ' '),
                      // the zone's abbreviations from its POSIX rule ("GMT0BST,…" → GMT BST)
                      keywords: (z.tz.match(/[A-Z]{3,}/g) ?? []).join(' '),
                    }),
                  )}
                  value={form.zonename}
                  onChange={(v) => {
                    set('zonename', v);
                  }}
                />
                {form.zonename === '' && (
                  <p className="text-xs text-muted-foreground">None chosen yet, so the router keeps UTC.</p>
                )}
              </Field>
              <Field
                id="ntp"
                label="Internet time"
                {...explain('Keeps the clock right using time servers (NTP).', ['system.ntp.enabled'])}
              >
                <Switch
                  id="ntp"
                  checked={form.ntp}
                  onCheckedChange={(v) => {
                    set('ntp', v);
                  }}
                />
              </Field>
              {form.ntp && (
                <Field
                  id="servers"
                  label="Time servers"
                  {...explain('One server name per line.', ['system.ntp.server'])}
                  error={errors.servers}
                >
                  <textarea
                    id="servers"
                    rows={4}
                    value={form.servers}
                    aria-invalid={errors.servers !== undefined}
                    aria-describedby={errors.servers === undefined ? undefined : 'servers-error'}
                    onChange={(e) => {
                      set('servers', e.target.value);
                    }}
                    className="w-full rounded-md border border-input bg-card px-3 py-2 font-mono text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30"
                  />
                </Field>
              )}
            </CardContent>
          </Card>
        )}
        <p className="text-sm text-muted-foreground">
          Restarts and Wi-Fi times you schedule are on{' '}
          <a href={href('schedules')} className="font-medium link">
            Scheduled tasks
          </a>
          .
        </p>
      </div>
      <SaveBar
        visible={dirty}
        busy={state.phase === 'applying'}
        invalid={Object.keys(errors).length > 0}
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
