// What the Logs page's settings decide: where the logs are kept and what
// each records. The switches that change how the router runs (the debug
// log's counters and snapshot, the memory error checker) are on
// Performance tuning, under Diagnostics; they write the same milkflint.logs
// section, so a save here writes them back as they were loaded.
import { type ReactElement, useCallback, useState } from 'react';
import { ApplyStatus } from '@/components/apply-status';
import { CardHeading } from '@/components/card-heading';
import { Field } from '@/components/field';
import { LoadError } from '@/components/page-states';
import { SaveBar } from '@/components/save-bar';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useApply } from '@/hooks/use-apply';
import { useLoad } from '@/hooks/use-load';
import { href } from '@/lib/router';
import { explain } from '@/components/explain';
import { MoreSettings } from '@/components/more-settings';
import { getLogSettings, type LogSettings, logSettingsChanges } from './api';

const sizes = ['1', '3', '10'];
const intervals = ['5', '10', '30', '60'];

// what the Wi-Fi log adds to its device lines, each with its own switch
const wifiParts: { key: 'channel' | 'mu' | 'rrm' | 'net'; option: string; title: string; hint: string }[] = [
  {
    key: 'channel',
    option: 'wifi_channel',
    title: 'Channel use',
    hint: 'How busy each channel was, and with what: our traffic, our devices, other networks, interference. Asks the Wi-Fi chip each sample.',
  },
  {
    key: 'mu',
    option: 'wifi_mu',
    title: 'MU/OFDMA counters',
    hint: 'Once a minute, how much went out to several devices at once (OFDMA, MU-MIMO) and beamformed. Turns on the driver’s statistics for it, which ask the Wi-Fi chip twice a second.',
  },
  {
    key: 'rrm',
    option: 'wifi_rrm',
    title: 'Ask devices how they hear the router',
    hint: 'A device having a hard time is asked how it hears the router (802.11k), at most once a minute, others every 10 minutes: one small frame each.',
  },
  {
    key: 'net',
    option: 'wifi_net',
    title: 'Network Quality',
    hint: 'The Network Quality probe’s response times (gateway, internet, DNS) each sample, beside the Wi-Fi lines of the same moment.',
  },
];

const uci = (option: string): string => `milkflint.logs.${option}`;

export function LogSettingsCard({ onApplied }: { onApplied: () => void }): ReactElement | null {
  const { data, error, loading, reload } = useLoad(getLogSettings);
  const [edit, setEdit] = useState<LogSettings>();
  const applied = useCallback(() => {
    setEdit(undefined);
    reload();
    onApplied();
  }, [reload, onApplied]);
  const { state, apply } = useApply(applied);
  const form = edit ?? data;
  const set = <K extends keyof LogSettings>(key: K, value: LogSettings[K]): void => {
    setEdit((current) => {
      const base = current ?? data;
      return base === undefined ? undefined : { ...base, [key]: value };
    });
  };
  const dirty = edit !== undefined && JSON.stringify(edit) !== JSON.stringify(data);

  if (error !== undefined && data === undefined) return <LoadError error={error} retry={reload} />;
  if (loading || form === undefined) return null;
  const partsOff = wifiParts.filter((p) => !form[p.key]).map((p) => p.title);
  return (
    <>
      <ApplyStatus state={state} />
      <Card>
        <CardHeading title="What gets logged" description="Where the logs are kept, and what each one records." />
        <CardContent>
          <div className="grid gap-x-10 xl:grid-cols-2">
            <section aria-labelledby="logs-which" className="flex min-w-0 flex-col">
              <h3 id="logs-which" className="border-b pb-2 text-sm font-semibold">
                Which logs
              </h3>
              <div className="divide-y">
                <Field
                  id="logs-wifi"
                  label="Wi-Fi log"
                  {...explain(
                    'Wi-Fi events from the system log, and a line for each connected device: signal, packets, retries, failures, speeds and queued airtime. NO TX marks a device that sent to the router but got nothing back.',
                    [uci('wifi')],
                  )}
                >
                  <Switch
                    id="logs-wifi"
                    checked={form.wifi}
                    onCheckedChange={(v) => {
                      set('wifi', v);
                    }}
                  />
                </Field>
                <Field
                  id="logs-radar"
                  label="Radar log"
                  {...explain(
                    'The 5 GHz radar checks, radar heard and the moves after it, always on the router’s storage (/root/milkflint-wifi, 64 KB). Networks & radios shows them too.',
                    [uci('radar')],
                  )}
                >
                  <Switch
                    id="logs-radar"
                    checked={form.radar}
                    onCheckedChange={(v) => {
                      set('radar', v);
                    }}
                  />
                </Field>
                <Field
                  id="logs-dns"
                  label="DNS log"
                  {...explain(
                    'For chasing slow pages or apps: each lookup that takes over 500 ms, fails or gets no answer, with the site and the device, a summary every minute, and the DNS services’ errors. To time them, the router notes every lookup in memory for a moment and keeps only the slow ones. Turning it on or off restarts the DNS service: a second without lookups.',
                    [uci('dns'), 'dhcp.@dnsmasq[0].logqueries'],
                  )}
                >
                  <Switch
                    id="logs-dns"
                    checked={form.dns}
                    onCheckedChange={(v) => {
                      set('dns', v);
                    }}
                  />
                </Field>
              </div>
            </section>
            <section aria-labelledby="logs-where" className="flex min-w-0 flex-col max-xl:mt-4">
              <h3 id="logs-where" className="border-b pb-2 text-sm font-semibold">
                Where they’re kept, and how often
              </h3>
              <div className="divide-y">
                <Field
                  id="logs-persist"
                  label="Keep after a restart"
                  {...explain(
                    'Saves the system log, the kernel’s lines included, the Wi-Fi, debug and DNS logs on the router’s storage (/root/milkflint-logs). Otherwise they’re only in memory, and a restart or crash clears them.',
                    [uci('persist')],
                  )}
                >
                  <Switch
                    id="logs-persist"
                    checked={form.persist}
                    onCheckedChange={(v) => {
                      set('persist', v);
                    }}
                  />
                </Field>
                <Field
                  id="logs-size"
                  label="Size per log"
                  {...explain('When a log reaches this, its older half is deleted.', [uci('size')])}
                >
                  <Select
                    value={form.size}
                    onValueChange={(v) => {
                      set('size', v);
                    }}
                  >
                    <SelectTrigger id="logs-size" className="w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {sizes.map((s) => (
                        <SelectItem key={s} value={s}>
                          {s} MB
                        </SelectItem>
                      ))}
                      {!sizes.includes(form.size) && <SelectItem value={form.size}>{form.size} MB</SelectItem>}
                    </SelectContent>
                  </Select>
                </Field>
                <Field
                  id="logs-interval"
                  label="Sample every"
                  {...explain('The Wi-Fi log’s devices (idle ones once a minute) and the debug counters.', [
                    uci('wifi_interval'),
                  ])}
                >
                  <Select
                    value={form.interval}
                    disabled={!form.wifi && !form.counters && !form.snapshot}
                    onValueChange={(v) => {
                      set('interval', v);
                    }}
                  >
                    <SelectTrigger id="logs-interval" className="w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {intervals.map((s) => (
                        <SelectItem key={s} value={s}>
                          {s} seconds
                        </SelectItem>
                      ))}
                      {!intervals.includes(form.interval) && (
                        <SelectItem value={form.interval}>{form.interval} seconds</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
            </section>
          </div>
          <MoreSettings
            summary={!form.wifi ? 'Wi-Fi log off' : partsOff.length === 0 ? undefined : `Off: ${partsOff.join(', ')}`}
          >
            <p className="py-3 text-sm text-muted-foreground">
              {form.wifi
                ? 'What the Wi-Fi log adds to each device’s line.'
                : 'What the Wi-Fi log adds to each device’s line, once the Wi-Fi log is on.'}
            </p>
            <div className="grid gap-x-10 divide-y xl:grid-cols-2 xl:divide-y-0">
              {wifiParts.map((p) => (
                <Field key={p.key} id={`logs-${p.key}`} label={p.title} {...explain(p.hint, [uci(p.option)])}>
                  <Switch
                    id={`logs-${p.key}`}
                    checked={form[p.key]}
                    disabled={!form.wifi}
                    onCheckedChange={(v) => {
                      set(p.key, v);
                    }}
                  />
                </Field>
              ))}
            </div>
          </MoreSettings>
          <p className="border-t pt-4 text-sm text-muted-foreground">
            The debug log’s counters and snapshot, and the memory error checker, change how the router runs, so they’re on{' '}
            <a href={`${href('tuning')}/diagnostics`} className="font-medium link">
              Performance tuning, under Diagnostics
            </a>
            .
          </p>
        </CardContent>
      </Card>
      <SaveBar
        visible={dirty}
        busy={state.phase === 'applying'}
        invalid={false}
        onSave={() => {
          if (data !== undefined) void apply(logSettingsChanges(form, data));
        }}
        onRevert={() => {
          setEdit(undefined);
        }}
      />
    </>
  );
}
