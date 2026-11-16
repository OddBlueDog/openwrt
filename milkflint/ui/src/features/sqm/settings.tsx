// Smart Queue's settings on the page: the line's speeds and its connection
// type first, then the less often changed ones under More settings. The
// expert ones (multi-queue, the upload's ACK filter and memory) are in the
// advanced sheet; the page still offers the ACK filter when the speeds call
// for it, and one CAKE when multi-queue can't run with what's set.
import { InfoIcon, TriangleAlertIcon } from 'lucide-react';
import type { ReactElement } from 'react';
import { CardHeading } from '@/components/card-heading';
import { Field } from '@/components/field';
import { Note } from '@/components/note';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { MoreSettings } from '@/components/more-settings';
import { ACK_FILTER_RATIO, suggestsAckFilter } from './ack-filter';
import {
  isPppoeDevice,
  type LatencyTarget,
  latencyTargets,
  type LinkGap,
  type LinkPreset,
  linkPresets,
  presetOverhead,
  type SqmData,
  type SqmErrors,
  type SqmForm,
} from './model';
import { linkUnasked, moreSummary } from './surface';

/** What the Connection type's choice has instead, when it's near a preset (./model.ts), for a queue on this device */
function gapText(gap: LinkGap, device: string): string {
  switch (gap) {
    case 'mpu':
      return 'no smallest packet size';
    case 'ptm':
      return 'no PTM';
    case 'overhead':
      return isPppoeDevice(device) ? 'the internet port’s overhead, short on a PPPoE session' : 'a PPPoE session’s overhead';
    case 'mechanism':
      return 'tc’s size table instead of CAKE’s own (in LuCI)';
  }
}

type Set = <K extends keyof SqmForm>(key: K, value: SqmForm[K]) => void;

function Speed({
  id,
  label,
  value,
  error,
  set,
}: {
  id: 'downloadMbit' | 'uploadMbit';
  label: string;
  value: string;
  error: string | undefined;
  set: Set;
}): ReactElement {
  return (
    <Field id={id} label={label} error={error}>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          inputMode="decimal"
          className="tabular"
          value={value}
          aria-invalid={error !== undefined}
          aria-describedby={`${id}-unit${error === undefined ? '' : ` ${id}-error`}`}
          onChange={(e) => {
            set(id, e.target.value.trim());
          }}
        />
        <span id={`${id}-unit`} className="shrink-0 text-sm text-muted-foreground">
          Mbit/s
        </span>
      </div>
    </Field>
  );
}

function ConnectionType({ form, data, set }: { form: SqmForm; data: SqmData; set: Set }): ReactElement {
  // OpenWrt's own queue comes without compensation: ask, rather than show that as chosen
  const ask = linkUnasked(data) && form.link === 'none';
  const near = form.link === 'custom' && data.form.link === 'custom' ? data.linkNear : undefined;
  return (
    <Field
      id="link"
      label="Connection type"
      hint="So shaping counts each packet’s overhead on your line. Not sure? Fibre / Ethernet."
      status={
        ((!ask && form.link === 'none') || near !== undefined) && (
          <>
            {!ask && form.link === 'none' && (
              <span className="mt-1 block text-warning">With no compensation, the queue can build up in your modem instead.</span>
            )}
            {near !== undefined && (
              <span className="mt-1 block text-warning">
                {linkPresets[near.preset].label} with {near.gaps.map((g) => gapText(g, data.form.device)).join(', ')}: choose{' '}
                {linkPresets[near.preset].label} again to set it as this page does.
              </span>
            )}
          </>
        )
      }
      why={
        <>
          Each kind of line adds bytes of its own to every packet (framing, ATM cells, a PPPoE header). Without them, CAKE counts
          packets as smaller than the line carries them, small ones such as acknowledgements most of all, so the queue builds up
          in your modem instead. Each choice sets sqm’s linklayer, overhead and tcMPU (and CAKE’s ptm for VDSL2); the Advanced
          sheet’s Line tab has them one by one.
        </>
      }
    >
      <Select
        value={ask ? '' : form.link}
        onValueChange={(v) => {
          set('link', v as LinkPreset | 'custom');
        }}
      >
        <SelectTrigger id="link">
          <SelectValue placeholder="Choose your connection type" />
        </SelectTrigger>
        <SelectContent>
          {Object.entries(linkPresets).map(([key, p]) => (
            <SelectItem key={key} value={key}>
              {p.linklayer === 'none' ? `${p.label} (not recommended)` : `${p.label} · ${presetOverhead(p, form.device)} bytes`}
            </SelectItem>
          ))}
          {form.link === 'custom' && (
            <SelectItem value="custom">
              {data.linkNear === undefined ? 'Custom: see Advanced' : `Custom: near ${linkPresets[data.linkNear.preset].label}`}
            </SelectItem>
          )}
        </SelectContent>
      </Select>
    </Field>
  );
}

function More({ form, data, set }: { form: SqmForm; data: SqmData; set: Set }): ReactElement {
  const unusual = moreSummary(form, data);
  const downloadsTinned = form.restoreDscp || data.squash.squash_ingress === '0';
  return (
    <MoreSettings summary={unusual.length > 0 ? unusual.join(' · ') : 'Mode, latency target, fairness, interface'}>
      <Field
        id="mode"
        label="Mode"
        hint={
          form.prioritise
            ? 'Calls and games go ahead of downloads and backups.'
            : 'One fair queue for everything. Best for most homes.'
        }
        why={
          form.prioritise
            ? downloadsTinned
              ? 'CAKE sorts traffic into tins by its DSCP marks, both ways (diffserv tins). sqm’s script: layer_cake.qos.'
              : 'CAKE sorts uploads into tins by their DSCP marks (diffserv tins). Downloads arrive with your provider’s marks, which mean nothing here: they get tins with Keep devices’ priorities on downloads. sqm’s script: layer_cake.qos.'
            : 'Every flow gets its fair share, with small ones such as calls and games going first anyway. sqm’s script: piece_of_cake.qos.'
        }
      >
        <Select
          value={form.prioritise ? 'layer' : 'simple'}
          onValueChange={(v) => {
            set('prioritise', v === 'layer');
          }}
        >
          <SelectTrigger id="mode">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="simple">Simple (piece_of_cake)</SelectItem>
            <SelectItem value="layer">Prioritise by traffic type (layer_cake)</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <Field
        id="latency"
        label="Latency target"
        hint="Calls, games and other small flows go first at any setting."
        why="Low asks big downloads and uploads to slow down sooner, so their queues stay shorter, for a little less speed. CAKE’s rtt, in both directions’ options (iqdisc_opts, eqdisc_opts)."
      >
        <Select
          value={form.latency}
          onValueChange={(v) => {
            set('latency', v as LatencyTarget | 'custom');
          }}
        >
          <SelectTrigger id="latency">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(latencyTargets).map(([key, t]) => (
              <SelectItem key={key} value={key}>
                {t.label}
              </SelectItem>
            ))}
            {form.latency === 'custom' && <SelectItem value="custom">Custom: see Advanced</SelectItem>}
          </SelectContent>
        </Select>
      </Field>
      <Field
        id="perDevice"
        label="Fair share per device"
        hint="One device’s downloads can’t crowd out the others."
        why="CAKE’s per-host isolation behind NAT: nat, dual-dsthost and ingress in the download’s options (iqdisc_opts), nat and dual-srchost in the upload’s (eqdisc_opts)."
      >
        <Switch
          id="perDevice"
          checked={form.perDevice}
          onCheckedChange={(v) => {
            set('perDevice', v);
          }}
        />
      </Field>
      <Field
        id="restoreDscp"
        label="Keep devices’ priorities on downloads"
        hint={form.enabled ? 'Downloads get back the priority mark their connection was sent with.' : undefined}
        status={form.enabled ? undefined : 'Needs Smart Queue on.'}
        why={
          <>
            Devices mark what they send as calls, video or background transfers (DSCP), but the marks don’t survive the way back
            from the internet. This puts each connection’s mark back on its downloads, so Wi-Fi sends a call’s ahead of other
            traffic and a backup’s behind it
            {form.prioritise ? ', and Prioritise by traffic type applies to downloads as well' : ''}. Sets
            milkflint.cake.dscp_restore, with sqm’s squash_dscp and squash_ingress.
            {!form.restoreDscp && data.squash.squash_dscp === '0' && (
              <span className="mt-1 block">
                Downloads keep your provider’s marks now (set in LuCI). This needs CAKE to clear them, so they’re cleared, and
                stay so if you turn it off again.
              </span>
            )}
          </>
        }
      >
        <Switch
          id="restoreDscp"
          checked={form.restoreDscp}
          disabled={!form.enabled}
          onCheckedChange={(v) => {
            set('restoreDscp', v);
          }}
        />
      </Field>
      <Field
        id="device"
        label="Interface"
        hint={
          data.pppoe === undefined
            ? 'Where to shape: your internet (WAN) port.'
            : `Where to shape: with PPPoE, the session’s own device (${data.pppoe}).`
        }
        why={
          data.pppoe === undefined
            ? 'sqm’s interface. The download is shaped on an ifb device sqm-scripts makes for it.'
            : `There CAKE reads the packets inside the PPPoE session; on the port it sees only PPPoE frames. sqm’s interface.`
        }
      >
        <Select
          value={form.device}
          onValueChange={(v) => {
            set('device', v);
          }}
        >
          <SelectTrigger id="device">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {/* the WAN's device even while a PPPoE session's is down */}
            {[...new Set([form.device, ...(data.wanDevice === undefined ? [] : [data.wanDevice]), ...data.devices])].map((d) => (
              <SelectItem key={d} value={d}>
                {d}
                {d === data.wanDevice && ' (WAN)'}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    </MoreSettings>
  );
}

export function SettingsCard({
  form,
  data,
  errors,
  set,
}: {
  form: SqmForm;
  data: SqmData;
  errors: SqmErrors;
  set: Set;
}): ReactElement {
  const ackChanged = form.ackFilter !== data.form.ackFilter;
  const suggestAck = form.enabled && form.ackFilter === 'off' && suggestsAckFilter(form.downloadMbit, form.uploadMbit);
  return (
    <Card>
      <CardHeading
        title="Your line"
        description="Set these to about 90% of your line’s measured speeds, when tested with Smart Queue off."
      />
      <CardContent>
        <div className="divide-y">
          <Speed id="downloadMbit" label="Download speed" value={form.downloadMbit} error={errors.downloadMbit} set={set} />
          <Speed id="uploadMbit" label="Upload speed" value={form.uploadMbit} error={errors.uploadMbit} set={set} />
          {errors.multiQueue !== undefined && (
            <Note tone="destructive" icon={<TriangleAlertIcon />} title="Multi-queue can’t run with this" className="py-3.5">
              <div className="flex flex-col items-start gap-2">
                <span>{errors.multiQueue}</span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    set('multiQueue', 'off');
                  }}
                >
                  Use one CAKE
                </Button>
              </div>
            </Note>
          )}
          {(suggestAck || ackChanged) && (
            <Note
              tone="info"
              icon={<InfoIcon />}
              title={ackChanged ? 'The upload ACK filter turns on when you save' : 'Try the upload ACK filter'}
              className="py-3.5"
            >
              {ackChanged ? (
                'It’s in Advanced (Upload) afterwards, with the rest of CAKE’s options.'
              ) : (
                <div className="flex flex-col items-start gap-2">
                  <span>
                    Your download is over {ACK_FILTER_RATIO} times your upload, so the acknowledgements downloads send back can
                    fill the upload and hold them back. The filter drops the ones a newer one has replaced (CAKE’s ack-filter).
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      set('ackFilter', 'on');
                    }}
                  >
                    Turn the ACK filter on
                  </Button>
                </div>
              )}
            </Note>
          )}
          <ConnectionType form={form} data={data} set={set} />
        </div>
        <More form={form} data={data} set={set} />
      </CardContent>
    </Card>
  );
}
