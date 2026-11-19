// Performance tuning's essentials: how what the ports receive is spread over
// the CPUs (packet steering), and the shortcut for established connections
// (flow offloading, in software or in the chip with WED).
import type { ReactElement } from 'react';
import { CardHeading } from '@/components/card-heading';
import { Field } from '@/components/field';
import { Note } from '@/components/note';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import type { NetworkLive } from '@/hooks/use-network-live';
import { href } from '@/lib/router';
import { splitHint } from '@/lib/hint';
import { RotateCwIcon } from 'lucide-react';
import { explain } from '@/components/explain';
import type { TuningStatus } from './api';
import {
  defaults,
  queueSwitch,
  type Steering,
  steeringIds,
  type SteeringInUse,
  steeringInUse,
  steeringOptions,
  type TuningData,
  type TuningForm,
} from './model';
import { NowRow } from './now-row';
import { wedNeedsRestart, wedNow } from './wed';

export type SetForm = <K extends keyof TuningForm>(key: K, value: TuningForm[K]) => void;

const RSS_MISSING =
  'Needs an image whose Ethernet has its four receive rings (MilkFlint’s RSS patches). This one doesn’t, so the RPS layout is used.';
const PPPOE_RSS =
  'Your internet connection is PPPoE, which RSS can’t spread: its downloads all arrive on ring 0, and only that ring is spread, in software. Automatic uses the RPS layout for it.';

/** What Automatic runs, and why when it isn't RSS */
function autoText(inUse: SteeringInUse, line: { pppoe: boolean; rssMissing: boolean }): string {
  if (inUse === 'rss') return 'RSS';
  return line.pppoe ? 'RPS, as your internet connection is PPPoE, which RSS can’t spread' : 'RPS, as this image has no RSS rings';
}

function isSteering(v: string): v is Steering {
  return (steeringIds as readonly string[]).includes(v);
}

export function SteeringCard({
  form,
  data,
  live,
  set,
}: {
  form: TuningForm;
  data: TuningData;
  live: NetworkLive | undefined;
  set: SetForm;
}): ReactElement {
  // RSS needs an image whose Ethernet has the four rings; without them the
  // script keeps the RPS layout
  const rssMissing = live !== undefined && live.rss === undefined;
  const line = { pppoe: data.pppoe, rssMissing };
  const queue = queueSwitch(form, data);
  const chosen = steeringOptions[form.steering].description;
  // RSS chosen where it can't be, or can't spread the internet connection
  const status = form.steering !== 'rss' ? undefined : rssMissing ? RSS_MISSING : data.pppoe ? PPPOE_RSS : undefined;
  return (
    <Card>
      <CardHeading title="Packet steering" description="How what the ports receive is spread over the CPUs." />
      <CardContent className="divide-y">
        <Field
          id="steering"
          label="Layout"
          hint={splitHint(chosen).lead}
          // the choice isn't in effect, or does little here: say so in every theme
          status={status}
          why={
            <div className="flex flex-col gap-2">
              <ul className="flex flex-col gap-1.5">
                {steeringIds.map((id) => (
                  <li key={id}>
                    <span className="font-medium">{steeringOptions[id].label}.</span>{' '}
                    {id === 'rss' && rssMissing ? RSS_MISSING : steeringOptions[id].description}
                  </li>
                ))}
              </ul>
              {
                explain('', [
                  'milkflint.steering.layout',
                  'milkflint.steering.rss',
                  'network.globals.packet_steering',
                  ...(queue === undefined ? [] : [`sqm.${data.sqm?.section ?? '<queue>'}.use_mq`, 'milkflint.cake.multi_queue']),
                ]).why
              }
            </div>
          }
        >
          <Select
            value={form.steering}
            onValueChange={(v) => {
              if (isSteering(v)) set('steering', v);
            }}
          >
            <SelectTrigger id="steering">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {steeringIds.map((id) => (
                <SelectItem key={id} value={id} disabled={id === 'rss' && rssMissing && form.steering !== 'rss'}>
                  {steeringOptions[id].label}
                  {id === defaults.steering ? ' (default)' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {form.steering === 'auto' && <NowRow label="Automatic uses">{autoText(steeringInUse('auto', line), line)}</NowRow>}
        {queue !== undefined && (
          <Field
            id="followQueue"
            label={queue ? 'Also turn on multi-queue CAKE' : 'Also switch Smart Queue to single-queue CAKE'}
            {...explain(
              queue
                ? 'Smart Queue then runs one CAKE queue per CPU that receives downloads, each on its own CPU, sharing your speed (cake_mq). It restarts for a moment.'
                : 'This layout sends every download through one queue, so multi-queue CAKE would run as one queue anyway. Smart Queue restarts for a moment.',
              [`sqm.${data.sqm?.section ?? '<queue>'}.use_mq`, 'milkflint.cake.multi_queue'],
            )}
          >
            <Switch
              id="followQueue"
              checked={form.followQueue}
              onCheckedChange={(v) => {
                set('followQueue', v);
              }}
            />
          </Field>
        )}
      </CardContent>
    </Card>
  );
}

export function OffloadCard({
  form,
  data,
  status,
  set,
  onRestart,
}: {
  form: TuningForm;
  data: TuningData;
  status: TuningStatus | undefined;
  set: SetForm;
  /** restart the router, for a WED setting the Wi-Fi driver hasn't taken yet */
  onRestart: () => void;
}): ReactElement {
  // an older router has no WED status, and so no setting to offer
  const wed = status?.wed;
  const pending = wedNeedsRestart(data.form.wed, wed);
  return (
    <Card>
      <CardHeading
        title="Flow offloading"
        description="A shortcut through the router for connections the firewall has already let through."
      />
      <CardContent>
        {data.firewall === undefined ? (
          <p className="py-3.5 text-sm text-muted-foreground">
            The firewall has no defaults section to set it in.{' '}
            <a href="/cgi-bin/luci/admin/network/firewall" target="_blank" rel="noreferrer" className="font-medium link">
              Look at it in LuCI
            </a>
            .
          </p>
        ) : (
          <div className="divide-y">
            <Field
              id="offload"
              label="Software flow offloading"
              {...explain(
                `Once a connection is established, its packets skip most of the firewall and routing work: much less CPU at high speeds. Smart Queue still shapes them. Off sends every packet the long way, for troubleshooting.${
                  !form.offload && (data.form.wed || data.firewall.hardware)
                    ? ' Hardware offloading, which needs it, is turned off too.'
                    : ''
                }`,
                ['firewall.@defaults[0].flow_offloading', 'firewall.@defaults[0].flow_offloading_hw'],
              )}
            >
              <Switch
                id="offload"
                checked={form.offload}
                onCheckedChange={(v) => {
                  set('offload', v);
                  if (!v) set('wed', false);
                }}
              />
            </Field>
            <Field
              id="wed"
              label="Hardware offloading (WED)"
              {...(data.accessPoint
                ? { status: 'Not as an access point: nothing is routed there that the hardware could take over.' }
                : explain(
                    'The router’s chip forwards established connections by itself, Wi-Fi included, and no CPU sees their packets: the least CPU and the highest speeds. Those packets also pass by everything the router does in software to keep latency low, so Smart Queue is turned off and the Wi-Fi’s own queue limits, fairness and pacing no longer reach them: expect more delay when the line or the Wi-Fi is busy. You’re shown what changes before it’s saved, and it takes a restart of the router.',
                    ['milkflint.wifi.wed'],
                  ))}
            >
              <div className="flex flex-wrap items-center gap-3">
                <Switch
                  id="wed"
                  checked={form.wed}
                  disabled={data.accessPoint || (wed === undefined && !form.wed)}
                  onCheckedChange={(v) => {
                    set('wed', v);
                    if (v) set('offload', true);
                  }}
                />
                <Badge variant="outline">Off by default</Badge>
              </div>
            </Field>
            {wed !== undefined && (data.form.wed || wed.loaded === true) && (
              <NowRow label="WED in use now">{wedNow(data.form.wed, wed)}</NowRow>
            )}
            {pending && (
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3.5">
                <Note tone="warning" icon={<RotateCwIcon />} className="min-w-0 flex-1">
                  {data.form.wed
                    ? 'The Wi-Fi driver takes WED when the router restarts. Until then only wired connections are forwarded in hardware.'
                    : 'The Wi-Fi driver lets go of WED when the router restarts. Until then the Wi-Fi’s fairness and the hold of a silent phone work only in part.'}
                </Note>
                <Button size="sm" variant="outline" onClick={onRestart}>
                  Restart the router
                </Button>
              </div>
            )}
            {!data.form.wed && data.firewall.hardware && (
              <p className="py-3.5 text-sm text-muted-foreground">
                Hardware offloading without WED is on in the{' '}
                <a href={href('firewall')} className="font-medium link">
                  Firewall
                </a>
                : wired connections are forwarded in hardware, past Smart Queue.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
