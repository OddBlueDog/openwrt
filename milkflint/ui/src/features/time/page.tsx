import { ClockIcon, LoaderCircleIcon, ServerIcon } from 'lucide-react';
import { type ReactElement, useCallback, useEffect, useState } from 'react';
import { ApplyStatus } from '@/components/apply-status';
import { CardHeading } from '@/components/card-heading';
import { Field } from '@/components/field';
import { PageHeader } from '@/components/layout/page-header';
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
import { errorMessage } from '@/lib/utils';

interface TimeForm {
  section: string;
  hostname: string;
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
      zonename: str(s, 'zonename') ?? 'UTC',
      ntp: ntp === undefined ? false : bool(ntp, 'enabled', true),
      servers: list(ntp, 'server').join('\n'),
    },
    zones,
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

function RouterClock(): ReactElement {
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

  return (
    <Card>
      <CardHeading icon={ClockIcon} title="Router clock" description="Local time on the router, ticking live." />
      <CardContent className="flex flex-col gap-4">
        <div className="font-mono text-3xl font-semibold tracking-tight tabular">
          {drift === undefined || zone === undefined
            ? '—'
            : new Date(now + drift + zone).toLocaleString('en-GB', { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'medium' })}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => void sync()} disabled={syncing === 'busy'}>
            {syncing === 'busy' && <LoaderCircleIcon className="animate-spin" />}
            Set from this browser
          </Button>
          {syncing !== undefined && syncing !== 'busy' && <span className="text-xs text-destructive">{syncing}</span>}
          {drift !== undefined && Math.abs(drift) > 60_000 && (
            <span className="text-xs text-warning">
              About {Math.round(Math.abs(drift) / 60_000)} min {drift > 0 ? 'ahead of' : 'behind'} this device.
            </span>
          )}
          {drift !== undefined && Math.abs(drift) <= 60_000 && <span className="text-xs text-success">In sync with this device.</span>}
        </div>
      </CardContent>
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
  if (form !== undefined && !HOSTNAME.test(form.hostname)) errors.hostname = 'Letters, digits and hyphens, not starting or ending with a hyphen.';
  if (form?.ntp === true && (serversOf(form.servers).length === 0 || !serversOf(form.servers).every((s) => SERVER.test(s)))) {
    errors.servers = 'One server name per line, e.g. 0.openwrt.pool.ntp.org.';
  }
  const dirty = edit !== undefined && JSON.stringify(edit) !== JSON.stringify(data?.form);

  const toChanges = (f: TimeForm): Change[] => {
    const tz = data?.zones.find((z) => z.name === f.zonename)?.tz ?? 'UTC0';
    const changes: Change[] = [
      { op: 'set', config: 'system', section: f.section, values: { hostname: f.hostname, zonename: f.zonename, timezone: tz } },
    ];
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
      <PageHeader title="Name & Time" description="The router's name, time zone and clock." />
      <div className="flex flex-col gap-4">
        <ApplyStatus state={state} />
        {error !== undefined && data === undefined ? (
          <LoadError error={error} retry={reload} />
        ) : loading || form === undefined || data === undefined ? (
          <FormSkeleton />
        ) : (
          <div className="grid items-start gap-4 xl:grid-cols-2">
            <Card>
              <CardHeading icon={ServerIcon} title="Name and time zone" />
              <CardContent className="divide-y">
                <Field id="hostname" label="Router name" hint="Shown on this page and to devices on your network." error={errors.hostname}>
                  <Input
                    id="hostname"
                    value={form.hostname}
                    aria-invalid={errors.hostname !== undefined}
                    onChange={(e) => {
                      set('hostname', e.target.value.trim());
                    }}
                  />
                </Field>
                <Field id="zonename" label="Time zone" hint="Search by city or region, or by an abbreviation like GMT or CET.">
                  <SearchSelect
                    id="zonename"
                    options={(data.zones.length > 0 ? data.zones : [{ name: form.zonename, tz: '' }]).map((z) => ({
                      value: z.name,
                      label: z.name.replaceAll('_', ' '),
                      // the zone's abbreviations from its POSIX rule ("GMT0BST,…" → GMT BST)
                      keywords: (z.tz.match(/[A-Z]{3,}/g) ?? []).join(' '),
                    }))}
                    value={form.zonename}
                    onChange={(v) => {
                      set('zonename', v);
                    }}
                  />
                </Field>
                <Field id="ntp" label="Internet time" hint="Keeps the clock right using time servers (NTP).">
                  <Switch
                    id="ntp"
                    checked={form.ntp}
                    onCheckedChange={(v) => {
                      set('ntp', v);
                    }}
                  />
                </Field>
                {form.ntp && (
                  <Field id="servers" label="Time servers" error={errors.servers}>
                    <textarea
                      id="servers"
                      rows={4}
                      value={form.servers}
                      aria-invalid={errors.servers !== undefined}
                      onChange={(e) => {
                        set('servers', e.target.value);
                      }}
                      className="w-full rounded-md border border-input bg-card px-3 py-2 font-mono text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30"
                    />
                  </Field>
                )}
              </CardContent>
            </Card>
            <RouterClock />
          </div>
        )}
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
