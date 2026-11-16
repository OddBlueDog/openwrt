// The page's opening answer: what the router's network path is doing now,
// read from the drivers and the kernel every 5 s (the steering every 2 s),
// and which settings differ from what MilkFlint ships with, with the way
// back to the defaults.
import { RotateCcwIcon } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import { CardHeading } from '@/components/card-heading';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { NetworkLive } from '@/hooks/use-network-live';
import type { LogSettings } from '../logs/api';
import type { TuningStatus } from './api';
import { ecnNow, l4sNow, retriesLabel, rxDelayLabel } from './knobs';
import { aqlInUse, groNow, spreadBadge, type Tier, type TuningData } from './model';
import { wedNow } from './wed';

function Row({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div className="grid gap-0.5 py-2.5 text-sm sm:grid-cols-[minmax(9rem,13rem)_minmax(0,1fr)] sm:gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 font-medium break-words">{children}</dd>
    </div>
  );
}

export function InEffectNow({
  data,
  status,
  live,
  diagnostics,
  changed,
  restoreDisabled,
  onRestore,
}: {
  data: TuningData;
  status: TuningStatus | undefined;
  live: NetworkLive | undefined;
  diagnostics: LogSettings | undefined;
  /** the saved settings that differ from the defaults */
  changed: readonly { tier: Tier; label: string }[];
  restoreDisabled: boolean;
  onRestore: () => void;
}): ReactElement {
  const port = status?.gro[0];
  const knobs = status?.knobs;
  const radios = status?.radios ?? [];
  const first = radios[0];
  const same =
    first !== undefined && radios.every((r) => r.low === first.low && r.high === first.high && r.threshold === first.threshold);
  const offload = data.firewall === undefined ? undefined : (port?.offload ?? data.form.offload);
  const wed = status?.wed;
  const diag =
    diagnostics === undefined
      ? []
      : [
          diagnostics.counters && 'debug counters',
          diagnostics.snapshot && 'snapshot on trouble',
          diagnostics.kfence && 'memory error checker',
        ].filter((x) => x !== false);
  const waiting = status === undefined ? '…' : undefined;

  return (
    <Card>
      <CardHeading
        title="In effect now"
        status={
          changed.length === 0
            ? 'Every setting is at MilkFlint’s default.'
            : `Changed from the defaults: ${changed.map((c) => c.label).join(', ')}.`
        }
        action={
          <Button variant="outline" size="sm" disabled={restoreDisabled} onClick={onRestore}>
            <RotateCcwIcon /> Restore defaults
          </Button>
        }
      />
      <CardContent>
        <dl className="grid divide-y border-t lg:grid-cols-2 lg:gap-x-10 lg:divide-y-0 lg:[&>div]:border-b">
          <Row label="Packet steering">
            {live === undefined ? '…' : <Badge variant={spreadBadge(live).variant}>{spreadBadge(live).text}</Badge>}
          </Row>
          <Row label="Flow offloading">
            {offload === undefined ? 'Not set in the firewall' : offload ? 'Software, on' : 'Off'}
            {wed !== undefined && (data.form.wed || wed.loaded === true) && `; WED ${wedNow(data.form.wed, wed).toLowerCase()}`}
          </Row>
          <Row label={port === undefined ? 'GRO' : `GRO on ${port.dev}`}>
            {port === undefined ? (waiting ?? '—') : groNow(port)}
          </Row>
          <Row label="Receive interrupt delay">
            {waiting ??
              (knobs?.rx_delay === null || knobs?.rx_delay === undefined ? 'Not in this image' : rxDelayLabel(knobs.rx_delay))}
          </Row>
          <Row label="Smart Queue ECN">{waiting ?? (knobs === undefined ? '—' : ecnNow(knobs.cake_ecn, knobs.cake_loaded))}</Row>
          <Row label="Smart Queue L4S">
            {waiting ?? (knobs === undefined ? '—' : l4sNow(knobs.cake_l4s, knobs.cake_loaded, data.sqm?.targetMs ?? null))}
          </Row>
          <Row label="Wi-Fi queue limit">
            {waiting ??
              (first === undefined
                ? 'No radios'
                : same
                  ? aqlInUse(first)
                  : radios.map((r) => `${r.phy} ${aqlInUse(r)}`).join('; '))}
          </Row>
          <Row label="Wi-Fi sends per frame">
            {waiting ??
              (knobs?.wifi_retries === null || knobs?.wifi_retries === undefined ? '—' : retriesLabel(knobs.wifi_retries))}
          </Row>
          <Row label="Diagnostics">
            {diagnostics === undefined ? '…' : diag.length === 0 ? 'All off' : `On: ${diag.join(', ')}`}
          </Row>
        </dl>
      </CardContent>
    </Card>
  );
}
