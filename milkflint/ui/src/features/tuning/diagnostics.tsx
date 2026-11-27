// Diagnostics: the switches that change how the router runs while chasing a
// dropout or a crash (the debug log's counters and snapshot, the kernel's
// memory error checker, KFENCE). They live in milkflint.logs with the Logs
// page's settings and are written the same way (../logs/api.ts); what they
// record shows on the Logs page's Debug and Crashes tabs.
import { pageLink } from '@/lib/router';
import { Link } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { CardHeading } from '@/components/card-heading';
import { Field } from '@/components/field';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import type { LogSettings } from '../logs/api';
import { explain } from '@/components/explain';

type Diagnostic = 'counters' | 'snapshot' | 'kfence';

const rows: { key: Diagnostic; option: string; label: string; text: string }[] = [
  {
    key: 'counters',
    option: 'debug_counters',
    label: 'Debug counters',
    text: 'The load and packets at each hop, every interval, in the debug log. For chasing a dropout: each interval the CPU, CAKE, the WAN port and Wi-Fi, and once a minute memory, the WAN and service restarts. The interval is Sample every, on the Logs page.',
  },
  {
    key: 'snapshot',
    option: 'debug_snapshot',
    label: 'Snapshot on trouble',
    text: 'Everything at once, in the debug log, when the connection stops. When Network Quality loses the internet or DNS, or a device gets NO TX: every queue, CPU, the Wi-Fi hardware queues and the last kernel lines, at most once a minute.',
  },
  {
    key: 'kfence',
    option: 'kfence',
    label: 'Memory error checker (KFENCE)',
    text: 'Reports memory the kernel misuses, on the Logs page’s Crashes tab. For chasing a crash: the kernel’s KFENCE watches a sample of its memory allocations, one every tenth of a second, and reports a use-after-free or out-of-bounds access with the code that made it. It uses 2 MB of memory and a little CPU while it’s on, and turning it on or off needs no restart.',
  },
];

export function DiagnosticsCard({
  form,
  set,
}: {
  form: LogSettings;
  set: (key: Diagnostic, value: boolean) => void;
}): ReactElement {
  const on = rows.filter((r) => form[r.key]).length;
  return (
    <Card id="diagnostics" className="scroll-mt-6">
      <CardHeading
        title="Diagnostics"
        description="For chasing a dropout or a crash; each costs a little while it’s on, so they start off."
        status={
          on > 0 && (
            <>
              What they record is on the{' '}
              <Link {...pageLink('logs')} className="font-medium link">
                Logs
              </Link>{' '}
              page.
            </>
          )
        }
      />
      <CardContent className="grid divide-y lg:grid-cols-3 lg:gap-x-8 lg:divide-y-0">
        {rows.map((r) => (
          <Field key={r.key} id={`diag-${r.key}`} label={r.label} {...explain(r.text, [`milkflint.logs.${r.option}`])}>
            <Switch
              id={`diag-${r.key}`}
              checked={form[r.key]}
              onCheckedChange={(v) => {
                set(r.key, v);
              }}
            />
          </Field>
        ))}
      </CardContent>
    </Card>
  );
}
