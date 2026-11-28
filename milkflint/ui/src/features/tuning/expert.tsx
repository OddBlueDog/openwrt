// Performance tuning's expert options, each with what it does now beside it:
// the CPUs' threads and receive interrupts, how the internet port groups
// what it receives (GRO), how Smart Queue treats ECN and L4S, and the Wi-Fi
// driver's queue. Every control names the option it writes under "Why?".
import type { ReactElement } from 'react';
import { CardHeading } from '@/components/card-heading';
import { ExperimentalBadge } from '@/components/experimental';
import { Field } from '@/components/field';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { formatNumber } from '@/lib/format';
import type { Whole } from '../sqm/gso';
import { explain } from '@/components/explain';
import type { GroPort, TuningStatus } from './api';
import type { SetForm } from './essentials';
import {
  AQL_OWN_TOTAL,
  type AqlTotal,
  aqlAutoTotal,
  ecnDropChoices,
  ecnDropLabel,
  ecnNow,
  lanRpsNow,
  l4sChoices,
  l4sLabel,
  l4sNow,
  retriesLabel,
  retryChoices,
  rxDelayLabel,
  rxDelayOptions,
  switchNow,
  voAggrChoices,
  voAggrLabel,
} from './knobs';
import { NowRow } from './now-row';
import {
  type Aql,
  aqlHighOf,
  aqlInUse,
  type Errors,
  type Gro,
  groLabels,
  groNow,
  groReason,
  groSizes,
  holdMs,
  sizeLabel,
  type TuningData,
  type TuningForm,
  type UdpFwd,
} from './model';

const mf = (section: string, option: string): string => `milkflint.${section}.${option}`;

/** "Hardware offloading is on": a line at the top of a card whose settings it passes by. */
function WedLine({ children }: { children: string }): ReactElement {
  return <p className="py-3 text-sm text-muted-foreground">{children}</p>;
}

const NOT_YET = 'This image doesn’t have it yet.';

/** An experimental on/off setting: its switch with the label beside it, held off where the image lacks it (one already on can still go off) */
function ExperimentalSwitch({
  id,
  checked,
  missing,
  onChange,
}: {
  id: string;
  checked: boolean;
  missing: boolean;
  onChange: (on: boolean) => void;
}): ReactElement {
  return (
    <span className="flex items-center gap-3">
      <Switch id={id} checked={checked} disabled={missing && !checked} onCheckedChange={onChange} />
      <ExperimentalBadge />
    </span>
  );
}

export function CpuCard({
  form,
  saved,
  status,
  rss,
  set,
}: {
  form: TuningForm;
  /** the settings as saved: an interrupt delay the page no longer offers stays a choice until it's saved away */
  saved: TuningForm;
  status: TuningStatus | undefined;
  rss: boolean;
  set: SetForm;
}): ReactElement {
  const knobs = status?.knobs;
  const now = knobs?.rx_delay;
  const choices = rxDelayOptions(saved.rxDelay, form.rxDelay);
  // where the image lacks a parameter: only known once the router said
  const pdmaStagMissing = knobs?.pdma_stag === null;
  const dsaGroMissing = knobs?.dsa_gro === null;
  const perRingMissing = knobs?.rx_dim_per_ring === null;
  const qdmaMissing = knobs?.qdma_tx_dim === null;
  return (
    <Card>
      <CardHeading
        title="CPUs and interrupts"
        description="Where the drivers’ threads run, and how long the Ethernet holds back an interrupt to collect more packets."
      />
      <CardContent className="divide-y">
        {rss ? (
          <>
            <Field
              id="wifiAll"
              label="Wi-Fi threads on every CPU"
              {...explain(
                'The Wi-Fi driver’s threads may run on CPU 0 too, so they wait less for a free CPU under load, for a little more CPU in all. Off keeps them on CPUs 1–3, with the receive rings.',
                [mf('steering', 'wifi_all')],
              )}
            >
              <Switch
                id="wifiAll"
                checked={form.wifiAll}
                onCheckedChange={(v) => {
                  set('wifiAll', v);
                }}
              />
            </Field>
            <Field
              id="ringsRt"
              label="Internet receive threads first"
              {...explain(
                'The receive rings’ threads run as soon as they wake (real-time priority) instead of waiting behind other work on their CPU: shorter delays under load, for a little more CPU.',
                [mf('steering', 'rings_rt')],
              )}
            >
              <Switch
                id="ringsRt"
                checked={form.ringsRt}
                onCheckedChange={(v) => {
                  set('ringsRt', v);
                }}
              />
            </Field>
            <Field
              id="lanRps"
              label="Spread what the LAN ports receive"
              {...explain(
                'With RSS, everything the LAN ports receive arrives on one receive ring, on CPU 0: the hardware spreads only the internet port. On, CPU 0 hands each of those connections on to CPUs 1–3 in software (packet steering, RPS), as without RSS, so a wired device’s upload, or what it sends to Wi-Fi, isn’t all handled on CPU 0. Costs CPU 0 a little for the handing on; downloads from the internet aren’t affected.',
                [mf('steering', 'lan_rps')],
              )}
            >
              <ExperimentalSwitch
                id="lanRps"
                checked={form.lanRps}
                missing={false}
                onChange={(v) => {
                  set('lanRps', v);
                }}
              />
            </Field>
            {knobs !== undefined && <NowRow label="LAN ports in use now">{lanRpsNow(knobs.lan_rps)}</NowRow>}
            <Field
              id="pdmaStag"
              label="Let RSS spread what the LAN ports receive"
              status={pdmaStagMissing ? NOT_YET : undefined}
              {...explain(
                'With RSS, everything the LAN ports receive arrives on one receive ring, on CPU 0, as the hardware’s hash can’t see past the switch’s tag. On, the frame engine reads that tag (its CDMP special tag), so RSS may spread wired traffic from the LAN ports over CPUs 1–3 too: in hardware, where Spread what the LAN ports receive hands it on in software. Never tried on this hardware: it was last on together with another register bug, and then all the internet port’s downloads stayed on ring 0. If downloads from the internet land on CPU 0 again with it on (one CPU busy, the others idle), turn it off. The driver takes it at once (mtk_eth’s pdma_stag).',
                [mf('steering', 'pdma_stag')],
              )}
            >
              <ExperimentalSwitch
                id="pdmaStag"
                checked={form.pdmaStag}
                missing={pdmaStagMissing}
                onChange={(v) => {
                  set('pdmaStag', v);
                }}
              />
            </Field>
            {knobs !== undefined && !pdmaStagMissing && (
              <NowRow label="Switch tag in use now">{switchNow(knobs.pdma_stag)}</NowRow>
            )}
          </>
        ) : (
          <p className="py-3.5 text-sm text-muted-foreground">
            The Wi-Fi thread, receive thread and LAN port spreading settings are for RSS packet steering, which isn’t in use.
          </p>
        )}
        <Field
          id="dsaGro"
          label="Group what the LAN ports receive in one pass"
          status={dsaGroMissing ? NOT_YET : undefined}
          {...explain(
            'What the LAN ports receive takes two passes now: the Ethernet driver’s, then a second grouping (GRO) pass on the LAN port, as a softirq (with RSS, on CPU 0). On, the driver hands each packet straight to GRO on its LAN port: one pass, for less CPU under wired traffic, such as a wired device’s upload or what it sends to Wi-Fi. Not yet measured on the router. Anything watching the switch port, eth0, itself (tcpdump -i eth0, tc or nft ingress on it) puts its packets back on the usual path by itself. Spread what the LAN ports receive keeps working: the steering script then hands them on at the LAN ports. The driver takes it at once (mtk_eth’s dsa_gro).',
            [mf('steering', 'dsa_gro')],
          )}
        >
          <ExperimentalSwitch
            id="dsaGro"
            checked={form.dsaGro}
            missing={dsaGroMissing}
            onChange={(v) => {
              set('dsaGro', v);
            }}
          />
        </Field>
        {knobs !== undefined && !dsaGroMissing && (
          <NowRow label="One-pass grouping in use now">{switchNow(knobs.dsa_gro)}</NowRow>
        )}
        <Field
          id="rxDelay"
          label="Longest receive interrupt delay"
          {...explain(
            'Shorter: received packets reach their CPU sooner, so pings and games wait less while something downloads, for more interrupts and a little more CPU under load. The hardware counts the delay in steps of 20 µs, so each choice is a multiple of 20, and under steady load the driver’s own choice usually sits at this limit. One setting for every port.',
            [mf('steering', 'rx_delay')],
          )}
        >
          <Select
            value={form.rxDelay === '' ? 'default' : form.rxDelay}
            onValueChange={(v) => {
              set('rxDelay', v === 'default' ? '' : v);
            }}
          >
            <SelectTrigger id="rxDelay">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {choices.map((v) => (
                <SelectItem key={v === '' ? 'default' : v} value={v === '' ? 'default' : v}>
                  {v === ''
                    ? `${rxDelayLabel('')} (default)`
                    : v === '0'
                      ? 'No limit: the driver’s own choice, up to 260 µs'
                      : rxDelayLabel(v)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {status !== undefined && (
          <NowRow label="In use now">{now === null || now === undefined ? 'Not in this image' : rxDelayLabel(now)}</NowRow>
        )}
        <Field
          id="rxDimPerRing"
          label="Each receive ring picks its own interrupt delay"
          status={perRingMissing ? NOT_YET : undefined}
          {...explain(
            'The Ethernet’s adaptive moderation picks each receive ring’s interrupt delay from that ring’s own traffic, rather than one delay for all of them, so a quiet ring needn’t wait as a busy one does. It matters more with a longer delay limit above: the delay moves in 20 µs steps, so at the default 80 µs the rings can differ by up to three steps. The driver takes it at its next moderation step, within moments under traffic (mtk_eth’s rx_dim_per_ring).',
            [mf('steering', 'rx_dim_per_ring')],
          )}
        >
          <ExperimentalSwitch
            id="rxDimPerRing"
            checked={form.rxDimPerRing}
            missing={perRingMissing}
            onChange={(v) => {
              set('rxDimPerRing', v);
            }}
          />
        </Field>
        {knobs !== undefined && !perRingMissing && (
          <NowRow label="Per-ring delays in use now">{switchNow(knobs.rx_dim_per_ring)}</NowRow>
        )}
        <Field
          id="qdmaTxDim"
          label="Send-complete interrupts follow sending’s own moderation"
          status={qdmaMissing ? NOT_YET : undefined}
          {...explain(
            'The interrupts that say sent packets are done wait as long as sending’s own adaptive moderation picks, as upstream Linux has it, rather than as long as receiving’s, as MediaTek’s code has it. Which of the two the hardware expects isn’t documented, so this tries the other way. The driver takes it at its next moderation step (mtk_eth’s qdma_tx_dim).',
            [mf('steering', 'qdma_tx_dim')],
          )}
        >
          <ExperimentalSwitch
            id="qdmaTxDim"
            checked={form.qdmaTxDim}
            missing={qdmaMissing}
            onChange={(v) => {
              set('qdmaTxDim', v);
            }}
          />
        </Field>
        {knobs !== undefined && !qdmaMissing && (
          <NowRow label="Send-complete moderation in use now">{switchNow(knobs.qdma_tx_dim)}</NowRow>
        )}
      </CardContent>
    </Card>
  );
}

export function GroCard({
  form,
  data,
  port,
  set,
}: {
  form: TuningForm;
  data: TuningData;
  port: GroPort | undefined;
  set: SetForm;
}): ReactElement {
  const dev = port?.dev ?? 'the internet port';
  const q = data.sqm;
  const plain = form.gro === 'plain' || (form.gro === 'auto' && port?.auto === 'plain');
  const groHint: Record<Gro, string> = {
    auto: `Plain GRO, up to 16 KB a group, when Smart Queue keeps grouped packets whole; fraglist GRO otherwise.${
      port === undefined ? '' : ` Now ${port.auto === 'plain' ? 'plain' : 'fraglist'}: ${groReason(port)}.`
    }`,
    fraglist:
      'OpenWrt’s default: a group keeps its packets, so the Wi-Fi port only has to unchain them again, and groups up to 64 KB. Taken whole, a group that size holds Smart Queue’s queue longer, and a ping waits behind it.',
    plain:
      'The packets are merged into one, in groups no bigger than the largest GRO packet below. Smaller groups let pings and games through Smart Queue sooner. With flow offloading on, UDP costs more CPU (the Wi-Fi port copies and checksums it apart), so UDP GRO forwarding stays off.',
    off: 'Every packet goes through Smart Queue and the firewall on its own: far more CPU. For troubleshooting.',
  };
  return (
    <Card>
      <CardHeading
        title="Receive grouping (GRO)"
        description={`How ${dev} groups the packets of each download before Smart Queue and the firewall handle them.`}
      />
      <CardContent className="divide-y">
        <Field id="gro" label="GRO" {...explain(groHint[form.gro], [mf('gro', 'mode')])}>
          <Select
            value={form.gro}
            onValueChange={(v) => {
              set('gro', v as Gro);
            }}
          >
            <SelectTrigger id="gro">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Automatic (default)</SelectItem>
              <SelectItem value="fraglist">{groLabels.fraglist}</SelectItem>
              <SelectItem value="plain">{groLabels.plain}</SelectItem>
              <SelectItem value="off">{groLabels.off}</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field
          id="udpFwd"
          label="UDP GRO forwarding"
          {...explain(
            'Lets plain GRO group forwarded UDP too (QUIC, games, VPNs); fraglist GRO groups it anyway. With flow offloading on it costs a Wi-Fi client more than it saves.',
            [mf('gro', 'udp_fwd')],
          )}
        >
          <Select
            value={form.udpFwd}
            onValueChange={(v) => {
              set('udpFwd', v as UdpFwd);
            }}
          >
            <SelectTrigger id="udpFwd">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Automatic: on with plain GRO while flow offloading is off (default)</SelectItem>
              <SelectItem value="on">On</SelectItem>
              <SelectItem value="off">Off</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field
          id="whole"
          label="Smart Queue keeps grouped packets whole"
          status={q === undefined || q.download <= 0 ? 'Smart Queue isn’t shaping downloads.' : undefined}
          {...explain(
            q === undefined || q.download <= 0
              ? 'Whole saves CPU; split lets a ping overtake sooner.'
              : `Whole saves CPU; split lets a ping overtake sooner. A 64 KB group holds the download queue ${holdMs(65536, q.download)} at your ${formatNumber(
                  q.download / 1000,
                )} Mbit/s${q.multiQueue ? ', longer in each multi-queue CAKE queue, which share the speed' : ''}. Smart Queue restarts for a moment when this changes.`,
            [mf('gro', 'whole'), `sqm.${q?.section ?? '<queue>'}.iqdisc_opts (no-split-gso)`],
          )}
        >
          <Select
            value={form.whole}
            disabled={q === undefined}
            onValueChange={(v) => {
              set('whole', v as Whole);
            }}
          >
            <SelectTrigger id="whole">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Automatic: from 500 Mbit/s (default)</SelectItem>
              <SelectItem value="on">Always</SelectItem>
              <SelectItem value="off">Never: split each one up</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field
          id="groMax"
          label="Largest GRO packet"
          {...explain(
            `Plain GRO only: fraglist GRO always groups up to 64 KB.${plain ? '' : ' Not in use now.'} Smaller groups hold a Smart Queue queue for less time when it takes them whole, for a little more CPU.`,
            [mf('gro', 'max_size')],
          )}
        >
          <Select
            value={form.groMax === '' ? 'default' : form.groMax}
            onValueChange={(v) => {
              set('groMax', v === 'default' ? '' : v);
            }}
          >
            <SelectTrigger id="groMax">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[...groSizes, ...(groSizes.includes(form.groMax) ? [] : [form.groMax])].map((v) => (
                <SelectItem key={v === '' ? 'default' : v} value={v === '' ? 'default' : v}>
                  {v === '' ? 'Automatic: 16 KB when Smart Queue takes groups whole, else 64 KB (default)' : sizeLabel(v)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {port !== undefined && (
          <>
            <NowRow label={`In use now on ${port.dev}`}>{groNow(port)}</NowRow>
            <NowRow label="Smart Queue">{port.whole ? 'keeps grouped packets whole' : 'splits grouped packets up'}</NowRow>
            <NowRow label="Flow offloading">{port.offload ? 'on' : 'off'}</NowRow>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function EcnCard({
  form,
  status,
  targetMs,
  set,
  wedOn,
}: {
  form: TuningForm;
  status: TuningStatus | undefined;
  /** the queue delay Smart Queue aims for, ms; null if it isn't known */
  targetMs: number | null;
  set: SetForm;
  /** hardware offloading with WED is on, and Smart Queue off for it */
  wedOn: boolean;
}): ReactElement {
  return (
    <Card>
      <CardHeading
        title="Smart Queue: ECN"
        description="How Smart Queue (CAKE) treats traffic that asks to be slowed by marks (ECN) rather than drops."
      />
      <CardContent className="divide-y">
        {wedOn && <WedLine>Hardware offloading (WED) is on and Smart Queue off for it: these wait until it runs again.</WedLine>}
        <Field
          id="ecnDrop"
          label="Drop from downloads that ignore the marks"
          {...explain(
            'Some servers answer Smart Queue’s marks and keep sending as fast as before, and their queue grows until Smart Queue drops from them instead, as from a download without ECN; then they slow down. Sooner keeps that queue short; the times are at the Standard latency target, half that at Low (Smart Queue page). L4S traffic has its own setting below.',
            [mf('cake', 'ecn_drop')],
          )}
        >
          <Select
            value={form.ecnDrop === '' ? 'default' : form.ecnDrop}
            onValueChange={(v) => {
              set('ecnDrop', v === 'default' ? '' : v);
            }}
          >
            <SelectTrigger id="ecnDrop">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[...ecnDropChoices, ...(ecnDropChoices.includes(form.ecnDrop) ? [] : [form.ecnDrop])].map((v) => (
                <SelectItem key={v === '' ? 'default' : v} value={v === '' ? 'default' : v}>
                  {v === ''
                    ? `${ecnDropLabel('')} (default)`
                    : v === '0'
                      ? `${ecnDropLabel(v)} (as CAKE upstream)`
                      : ecnDropLabel(v)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {status !== undefined && <NowRow label="In use now">{ecnNow(status.knobs.cake_ecn, status.knobs.cake_loaded)}</NowRow>}
        <Field
          id="l4s"
          label="Mark L4S traffic by how long it waited"
          {...explain(
            'Some apps and servers (Apple’s, for one) use L4S, a kind of ECN that slows down a little for each mark and needs many of them. Smart Queue marks their packets by how long each waited, more of them the longer, from your Latency target up. Sooner keeps their queue shorter at more of their speed. Off, they get only the few marks other ECN traffic gets and hold a longer queue. Other traffic isn’t affected, and the change takes effect at once.',
            [mf('cake', 'l4s')],
          )}
        >
          <Select
            value={form.l4s === '' ? 'default' : form.l4s}
            onValueChange={(v) => {
              set('l4s', v === 'default' ? '' : v);
            }}
          >
            <SelectTrigger id="l4s">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[...l4sChoices, ...(l4sChoices.includes(form.l4s) ? [] : [form.l4s])].map((v) => (
                <SelectItem key={v === '' ? 'default' : v} value={v === '' ? 'default' : v}>
                  {l4sLabel(v, targetMs)}
                  {v === ''
                    ? ' (default)'
                    : v === '0'
                      ? ' (as CAKE upstream)'
                      : v === '60'
                        ? ': shorter queue, less speed'
                        : v === '200'
                          ? ': more speed, longer queue'
                          : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {status !== undefined && (
          <NowRow label="L4S in use now">{l4sNow(status.knobs.cake_l4s, status.knobs.cake_loaded, targetMs)}</NowRow>
        )}
      </CardContent>
    </Card>
  );
}

export function AqlCard({
  form,
  errors,
  status,
  set,
  wedOn,
}: {
  form: TuningForm;
  errors: Errors;
  status: TuningStatus | undefined;
  set: SetForm;
  /** hardware offloading with WED is on: what it forwards passes these settings by */
  wedOn: boolean;
}): ReactElement {
  const radios = status?.radios ?? [];
  const first = radios[0];
  const same =
    first !== undefined && radios.every((r) => r.low === first.low && r.high === first.high && r.threshold === first.threshold);
  const high = aqlHighOf(form);
  const retriesNow = status?.knobs.wifi_retries ?? null;
  const voAggrNow = status?.knobs.wifi_vo_aggr ?? null;
  return (
    <Card>
      <CardHeading
        title="Wi-Fi driver queue"
        description="How much airtime of best-effort traffic each device may have waiting in the Wi-Fi driver (AQL), and how often it sends a frame."
      />
      <CardContent className="divide-y">
        {wedOn && (
          <WedLine>
            Hardware offloading (WED) is on: connections it forwards pass these by. They still apply to what goes through the
            router’s software.
          </WedLine>
        )}
        <Field
          id="aql"
          label="Queue limit (AQL)"
          {...explain(
            'Shorter keeps latency down when a device’s Wi-Fi is slower than the download. Every radio takes it at once.',
            [mf('wifi', 'aql_be')],
          )}
        >
          <Select
            value={form.aql}
            onValueChange={(v) => {
              set('aql', v as Aql);
            }}
          >
            <SelectTrigger id="aql">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default">2,500 / 5,000 µs (default)</SelectItem>
              <SelectItem value="off">5,000 / 12,000 µs (mac80211’s own)</SelectItem>
              <SelectItem value="custom">Custom</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        {form.aql === 'custom' && (
          <>
            <Field
              id="aqlLow"
              label="Low limit"
              hint="µs per device, while the radio has more than its total below waiting: usually two or more busy devices."
              error={errors.aqlLow}
            >
              <Input
                id="aqlLow"
                inputMode="numeric"
                className="w-28 tabular"
                value={form.aqlLow}
                aria-invalid={errors.aqlLow !== undefined}
                aria-describedby={errors.aqlLow === undefined ? undefined : 'aqlLow-error'}
                onChange={(e) => {
                  set('aqlLow', e.target.value.trim());
                }}
              />
            </Field>
            <Field
              id="aqlHigh"
              label="High limit"
              hint="µs per device, the rest of the time: with one busy device, nearly always."
              error={errors.aqlHigh}
            >
              <Input
                id="aqlHigh"
                inputMode="numeric"
                className="w-28 tabular"
                value={form.aqlHigh}
                aria-invalid={errors.aqlHigh !== undefined}
                aria-describedby={errors.aqlHigh === undefined ? undefined : 'aqlHigh-error'}
                onChange={(e) => {
                  set('aqlHigh', e.target.value.trim());
                }}
              />
            </Field>
          </>
        )}
        <Field
          id="aqlTotal"
          label="Radio’s total"
          {...explain(
            'Once this much airtime is waiting for all devices together, each is held to its low limit, so several busy devices share this total rather than each keeping the high limit waiting. Smaller keeps latency down when the Wi-Fi is full, at a little speed. It never holds back a device on its own, and every radio takes it at once.',
            [mf('wifi', 'aql_threshold')],
          )}
          error={errors.aqlTotal}
        >
          <Select
            value={form.aqlTotal}
            onValueChange={(v) => {
              set('aqlTotal', v as AqlTotal);
            }}
          >
            <SelectTrigger id="aqlTotal">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">
                {Number.isNaN(high)
                  ? 'Automatic: 1.2 times the high limit (default)'
                  : form.aql === 'off'
                    ? `${formatNumber(aqlAutoTotal(high, true))} µs (default with mac80211’s limits)`
                    : `${formatNumber(aqlAutoTotal(high, false))} µs, 1.2 times the high limit (default)`}
              </SelectItem>
              {(form.aql !== 'off' || form.aqlTotal === 'own') && (
                <SelectItem value="own">{formatNumber(AQL_OWN_TOTAL)} µs (mac80211’s own)</SelectItem>
              )}
              <SelectItem value="custom">Custom</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        {form.aqlTotal === 'custom' && (
          <Field
            id="aqlTotalCustom"
            label="Custom total"
            hint={`µs, from the high limit${Number.isNaN(high) ? '' : ` (${formatNumber(high)})`} to 50,000.`}
          >
            <Input
              id="aqlTotalCustom"
              inputMode="numeric"
              className="w-28 tabular"
              value={form.aqlTotalCustom}
              aria-invalid={errors.aqlTotal !== undefined}
              onChange={(e) => {
                set('aqlTotalCustom', e.target.value.trim());
              }}
            />
          </Field>
        )}
        {status !== undefined &&
          (same || first === undefined ? (
            <NowRow
              label={radios.length > 1 ? `Queue limit in use now, ${String(radios.length)} radios` : 'Queue limit in use now'}
            >
              {first === undefined ? 'no radios' : aqlInUse(first)}
            </NowRow>
          ) : (
            radios.map((r) => (
              <NowRow key={r.phy} label={`Queue limit in use now, ${r.phy}`}>
                {aqlInUse(r)}
              </NowRow>
            ))
          ))}
        <Field
          id="retries"
          label="Sends per frame"
          {...explain(
            'How many times the driver sends a data frame before it gives up on it. Fewer: when the air is busy, a device’s later frames wait less behind one that keeps failing, and TCP resends what was given up. For a crowded neighbourhood; otherwise leave it.',
            [mf('wifi', 'retries')],
          )}
        >
          <Select
            value={form.retries === '' ? 'default' : form.retries}
            onValueChange={(v) => {
              set('retries', v === 'default' ? '' : v);
            }}
          >
            <SelectTrigger id="retries">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[...retryChoices, ...(retryChoices.includes(form.retries) ? [] : [form.retries])].map((v) => (
                <SelectItem key={v === '' ? 'default' : v} value={v === '' ? 'default' : v}>
                  {v === '' ? `${retriesLabel('')} (default, as stock)` : retriesLabel(v)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {retriesNow !== null && <NowRow label="Sends in use now">{retriesLabel(retriesNow)}</NowRow>}
        <Field
          id="voAggr"
          label="Voice queue aggregation"
          {...explain(
            'Sends traffic marked as voice in groups of frames, as everything else is sent. Without it, a device that has just joined and gets nothing else can stay at the lowest rate, and even a modest flow then takes the air from everyone. Stock OpenWrt leaves it off: turn it off if a device starts dropping out during calls.',
            [mf('wifi', 'vo_aggr')],
          )}
        >
          <Select
            value={form.voAggr === '' ? 'on' : form.voAggr}
            onValueChange={(v) => {
              set('voAggr', v === 'on' ? '' : v);
            }}
          >
            <SelectTrigger id="voAggr">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {voAggrChoices.map((v) => (
                <SelectItem key={v === '' ? 'on' : v} value={v === '' ? 'on' : v}>
                  {voAggrLabel(v)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {voAggrNow !== null && <NowRow label="Voice queue aggregation in use now">{voAggrNow ? 'On' : 'Off'}</NowRow>}
      </CardContent>
    </Card>
  );
}
