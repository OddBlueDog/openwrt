// What the Logs page's settings decide: where the logs are kept and what
// each records. The switches that change how the router runs (the debug
// log's counters and snapshot, the memory error checker) are on
// Performance tuning, under Diagnostics; they write the same milkflint.logs
// section, so a save here writes them back as they were loaded.
import { useSuspenseQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { ApplyStatus } from '@/components/apply-status';
import { CardHeading } from '@/components/card-heading';
import { explain } from '@/components/explain';
import { FormSaveBar, SelectField, SwitchField } from '@/components/form';
import { MoreSettings } from '@/components/more-settings';
import { Card, CardContent } from '@/components/ui/card';
import { useApply } from '@/hooks/use-apply';
import { useFormValues, useSettingsForm } from '@/lib/form/use-settings-form';
import { pageLink } from '@/lib/router';
import { logSettingsChanges } from './api';
import { logSettingsSchema } from './model';
import { logsQueries } from './queries';

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

/** What gets logged: inside a PageBoundary (nothing shows while it loads). */
export function LogSettingsCard(): ReactElement {
  const { data } = useSuspenseQuery(logsQueries.settings());
  const { state, apply } = useApply();
  const settings = useSettingsForm({
    schema: logSettingsSchema,
    saved: data,
    onSave: (values) => apply(logSettingsChanges(values, data)),
  });
  const { form } = settings;
  const values = useFormValues(form);
  const partsOff = wifiParts.filter((p) => !values[p.key]).map((p) => p.title);
  const sizeOptions = [...sizes, ...(sizes.includes(values.size) ? [] : [values.size])].map((v) => ({
    value: v,
    label: `${v} MB`,
  }));
  const intervalOptions = [...intervals, ...(intervals.includes(values.interval) ? [] : [values.interval])].map((v) => ({
    value: v,
    label: `${v} seconds`,
  }));
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
                <form.Field name="wifi">
                  {(field) => (
                    <SwitchField
                      field={field}
                      id="logs-wifi"
                      label="Wi-Fi log"
                      {...explain(
                        'Wi-Fi events from the system log, and a line for each connected device: signal, packets, retries, failures, speeds and queued airtime. NO TX marks a device that sent to the router but got nothing back.',
                        [uci('wifi')],
                      )}
                    />
                  )}
                </form.Field>
                <form.Field name="radar">
                  {(field) => (
                    <SwitchField
                      field={field}
                      id="logs-radar"
                      label="Radar log"
                      {...explain(
                        'The 5 GHz radar checks, radar heard and the moves after it, always on the router’s storage (/root/milkflint-wifi, 64 KB). Networks & radios shows them too.',
                        [uci('radar')],
                      )}
                    />
                  )}
                </form.Field>
                <form.Field name="dns">
                  {(field) => (
                    <SwitchField
                      field={field}
                      id="logs-dns"
                      label="DNS log"
                      {...explain(
                        'For chasing slow pages or apps: each lookup that takes over 500 ms, fails or gets no answer, with the site and the device, a summary every minute, and the DNS services’ errors. To time them, the router notes every lookup in memory for a moment and keeps only the slow ones. Turning it on or off restarts the DNS service: a second without lookups.',
                        [uci('dns'), 'dhcp.@dnsmasq[0].logqueries'],
                      )}
                    />
                  )}
                </form.Field>
              </div>
            </section>
            <section aria-labelledby="logs-where" className="flex min-w-0 flex-col max-xl:mt-4">
              <h3 id="logs-where" className="border-b pb-2 text-sm font-semibold">
                Where they’re kept, and how often
              </h3>
              <div className="divide-y">
                <form.Field name="persist">
                  {(field) => (
                    <SwitchField
                      field={field}
                      id="logs-persist"
                      label="Keep after a restart"
                      {...explain(
                        'Saves the system log, the kernel’s lines included, the Wi-Fi, debug and DNS logs on the router’s storage (/root/milkflint-logs). Otherwise they’re only in memory, and a restart or crash clears them.',
                        [uci('persist')],
                      )}
                    />
                  )}
                </form.Field>
                <form.Field name="size">
                  {(field) => (
                    <SelectField
                      field={field}
                      id="logs-size"
                      label="Size per log"
                      {...explain('When a log reaches this, its older half is deleted.', [uci('size')])}
                      options={sizeOptions}
                      triggerClassName="w-40"
                    />
                  )}
                </form.Field>
                <form.Field name="interval">
                  {(field) => (
                    <SelectField
                      field={field}
                      id="logs-interval"
                      label="Sample every"
                      {...explain('The Wi-Fi log’s devices (idle ones once a minute) and the debug counters.', [
                        uci('wifi_interval'),
                      ])}
                      options={intervalOptions}
                      disabled={!values.wifi && !values.counters && !values.snapshot}
                      triggerClassName="w-40"
                    />
                  )}
                </form.Field>
              </div>
            </section>
          </div>
          <MoreSettings
            summary={!values.wifi ? 'Wi-Fi log off' : partsOff.length === 0 ? undefined : `Off: ${partsOff.join(', ')}`}
          >
            <p className="py-3 text-sm text-muted-foreground">
              {values.wifi
                ? 'What the Wi-Fi log adds to each device’s line.'
                : 'What the Wi-Fi log adds to each device’s line, once the Wi-Fi log is on.'}
            </p>
            <div className="grid gap-x-10 divide-y xl:grid-cols-2 xl:divide-y-0">
              {wifiParts.map((p) => (
                <form.Field key={p.key} name={p.key}>
                  {(field) => (
                    <SwitchField
                      field={field}
                      id={`logs-${p.key}`}
                      label={p.title}
                      {...explain(p.hint, [uci(p.option)])}
                      disabled={!values.wifi}
                    />
                  )}
                </form.Field>
              ))}
            </div>
          </MoreSettings>
          <p className="border-t pt-4 text-sm text-muted-foreground">
            The debug log’s counters and snapshot, and the memory error checker, change how the router runs, so they’re on{' '}
            <Link {...pageLink('tuning', 'diagnostics')} className="font-medium link">
              Performance tuning, under Diagnostics
            </Link>
            .
          </p>
        </CardContent>
      </Card>
      <FormSaveBar settings={settings} busy={state.phase === 'applying'} />
    </>
  );
}
