// Smart Queue's settings on the page: the line's speeds and its connection
// type first, then the less often changed ones under More settings. The
// expert ones (multi-queue, the upload's ACK filter and memory) are in the
// advanced sheet; the page still offers the ACK filter when the speeds call
// for it, and one CAKE when multi-queue can't run with what's set.
import { InfoIcon, TriangleAlertIcon } from 'lucide-react';
import type { ReactElement } from 'react';
import { CardHeading } from '@/components/card-heading';
import { FormField, SelectField, SwitchField } from '@/components/form';
import { MoreSettings } from '@/components/more-settings';
import { Note } from '@/components/note';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { SettingsFormApi } from '@/lib/form/use-settings-form';
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

type Form = SettingsFormApi<SqmForm>;

const isPreset = (v: string): v is LinkPreset => v in linkPresets;
const isLatency = (v: string): v is LatencyTarget => v in latencyTargets;

function Speed({ form, id, label }: { form: Form; id: 'downloadMbit' | 'uploadMbit'; label: string }): ReactElement {
  return (
    <form.Field name={id}>
      {(field) => (
        <FormField field={field} id={id} label={label}>
          {(control) => (
            <div className="flex items-center gap-2">
              <Input
                {...control}
                inputMode="decimal"
                className="tabular"
                value={field.state.value}
                aria-describedby={[`${id}-unit`, control['aria-describedby']].filter((x) => x !== undefined).join(' ')}
                onChange={(e) => {
                  field.handleChange(e.target.value.trim());
                }}
                onBlur={field.handleBlur}
              />
              <span id={`${id}-unit`} className="shrink-0 text-sm text-muted-foreground">
                Mbit/s
              </span>
            </div>
          )}
        </FormField>
      )}
    </form.Field>
  );
}

function ConnectionType({ form, values, data }: { form: Form; values: SqmForm; data: SqmData }): ReactElement {
  // OpenWrt's own queue comes without compensation: ask, rather than show that as chosen
  const ask = linkUnasked(data) && values.link === 'none';
  const near = values.link === 'custom' && data.form.link === 'custom' ? data.linkNear : undefined;
  return (
    <form.Field name="link">
      {(field) => (
        <FormField
          field={field}
          id="link"
          label="Connection type"
          hint="So shaping counts each packet’s overhead on your line. Not sure? Fibre / Ethernet."
          status={
            ((!ask && values.link === 'none') || near !== undefined) && (
              <>
                {!ask && values.link === 'none' && (
                  <span className="mt-1 block text-warning">
                    With no compensation, the queue can build up in your modem instead.
                  </span>
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
              Each kind of line adds bytes of its own to every packet (framing, ATM cells, a PPPoE header). Without them, CAKE
              counts packets as smaller than the line carries them, small ones such as acknowledgements most of all, so the queue
              builds up in your modem instead. Each choice sets sqm’s linklayer, overhead and tcMPU (and CAKE’s ptm for VDSL2);
              the Advanced sheet’s Line tab has them one by one.
            </>
          }
        >
          {(control) => (
            <Select
              value={ask ? '' : field.state.value}
              onValueChange={(v) => {
                field.handleChange(isPreset(v) ? v : 'custom');
              }}
            >
              <SelectTrigger {...control} onBlur={field.handleBlur}>
                <SelectValue placeholder="Choose your connection type" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(linkPresets).map(([key, p]) => (
                  <SelectItem key={key} value={key}>
                    {p.linklayer === 'none'
                      ? `${p.label} (not recommended)`
                      : `${p.label} · ${presetOverhead(p, values.device)} bytes`}
                  </SelectItem>
                ))}
                {values.link === 'custom' && (
                  <SelectItem value="custom">
                    {data.linkNear === undefined
                      ? 'Custom: see Advanced'
                      : `Custom: near ${linkPresets[data.linkNear.preset].label}`}
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
          )}
        </FormField>
      )}
    </form.Field>
  );
}

function More({ form, values, data }: { form: Form; values: SqmForm; data: SqmData }): ReactElement {
  const unusual = moreSummary(values, data);
  const downloadsTinned = values.restoreDscp || data.squash.squash_ingress === '0';
  return (
    <MoreSettings summary={unusual.length > 0 ? unusual.join(' · ') : 'Mode, latency target, fairness, interface'}>
      <form.Field name="prioritise">
        {(field) => (
          <FormField
            field={field}
            id="mode"
            label="Mode"
            hint={
              values.prioritise
                ? 'Calls and games go ahead of downloads and backups.'
                : 'One fair queue for everything. Best for most homes.'
            }
            why={
              values.prioritise
                ? downloadsTinned
                  ? 'CAKE sorts traffic into tins by its DSCP marks, both ways (diffserv tins). sqm’s script: layer_cake.qos.'
                  : 'CAKE sorts uploads into tins by their DSCP marks (diffserv tins). Downloads arrive with your provider’s marks, which mean nothing here: they get tins with Keep devices’ priorities on downloads. sqm’s script: layer_cake.qos.'
                : 'Every flow gets its fair share, with small ones such as calls and games going first anyway. sqm’s script: piece_of_cake.qos.'
            }
          >
            {(control) => (
              <Select
                value={field.state.value ? 'layer' : 'simple'}
                onValueChange={(v) => {
                  field.handleChange(v === 'layer');
                }}
              >
                <SelectTrigger {...control} onBlur={field.handleBlur}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="simple">Simple (piece_of_cake)</SelectItem>
                  <SelectItem value="layer">Prioritise by traffic type (layer_cake)</SelectItem>
                </SelectContent>
              </Select>
            )}
          </FormField>
        )}
      </form.Field>
      <form.Field name="latency">
        {(field) => (
          <SelectField
            field={field}
            id="latency"
            label="Latency target"
            hint="Calls, games and other small flows go first at any setting."
            why="Low asks big downloads and uploads to slow down sooner, so their queues stay shorter, for a little less speed. CAKE’s rtt, in both directions’ options (iqdisc_opts, eqdisc_opts)."
            options={[
              ...Object.entries(latencyTargets).flatMap(([key, t]) => (isLatency(key) ? [{ value: key, label: t.label }] : [])),
              ...(values.latency === 'custom' ? [{ value: 'custom' as const, label: 'Custom: see Advanced' }] : []),
            ]}
          />
        )}
      </form.Field>
      <form.Field name="perDevice">
        {(field) => (
          <SwitchField
            field={field}
            id="perDevice"
            label="Fair share per device"
            hint="One device’s downloads can’t crowd out the others."
            why="CAKE’s per-host isolation behind NAT: nat, dual-dsthost and ingress in the download’s options (iqdisc_opts), nat and dual-srchost in the upload’s (eqdisc_opts)."
          />
        )}
      </form.Field>
      <form.Field name="restoreDscp">
        {(field) => (
          <SwitchField
            field={field}
            id="restoreDscp"
            label="Keep devices’ priorities on downloads"
            hint={values.enabled ? 'Downloads get back the priority mark their connection was sent with.' : undefined}
            status={values.enabled ? undefined : 'Needs Smart Queue on.'}
            disabled={!values.enabled}
            why={
              <>
                Devices mark what they send as calls, video or background transfers (DSCP), but the marks don’t survive the way
                back from the internet. This puts each connection’s mark back on its downloads, so Wi-Fi sends a call’s ahead of
                other traffic and a backup’s behind it
                {values.prioritise ? ', and Prioritise by traffic type applies to downloads as well' : ''}. Sets
                milkflint.cake.dscp_restore, with sqm’s squash_dscp and squash_ingress.
                {!values.restoreDscp && data.squash.squash_dscp === '0' && (
                  <span className="mt-1 block">
                    Downloads keep your provider’s marks now (set in LuCI). This needs CAKE to clear them, so they’re cleared, and
                    stay so if you turn it off again.
                  </span>
                )}
              </>
            }
          />
        )}
      </form.Field>
      <form.Field name="device">
        {(field) => (
          <SelectField
            field={field}
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
            // the WAN's device even while a PPPoE session's is down
            options={[
              ...new Set([values.device, ...(data.wanDevice === undefined ? [] : [data.wanDevice]), ...data.devices]),
            ].map((d) => ({ value: d, label: d === data.wanDevice ? `${d} (WAN)` : d }))}
          />
        )}
      </form.Field>
    </MoreSettings>
  );
}

export function SettingsCard({
  form,
  values,
  data,
  errors,
}: {
  form: Form;
  values: SqmForm;
  data: SqmData;
  /** the checks as they stand: the multi-queue one shows as a note */
  errors: SqmErrors;
}): ReactElement {
  const ackChanged = values.ackFilter !== data.form.ackFilter;
  const suggestAck = values.enabled && values.ackFilter === 'off' && suggestsAckFilter(values.downloadMbit, values.uploadMbit);
  return (
    <Card>
      <CardHeading
        title="Your line"
        description="Set these to about 90% of your line’s measured speeds, when tested with Smart Queue off."
      />
      <CardContent>
        <div className="divide-y">
          <Speed form={form} id="downloadMbit" label="Download speed" />
          <Speed form={form} id="uploadMbit" label="Upload speed" />
          {errors.multiQueue !== undefined && (
            <Note tone="destructive" icon={<TriangleAlertIcon />} title="Multi-queue can’t run with this" className="py-3.5">
              <div className="flex flex-col items-start gap-2">
                <span>{errors.multiQueue}</span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    form.setFieldValue('multiQueue', 'off');
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
                      form.setFieldValue('ackFilter', 'on');
                    }}
                  >
                    Turn the ACK filter on
                  </Button>
                </div>
              )}
            </Note>
          )}
          <ConnectionType form={form} values={values} data={data} />
        </div>
        <More form={form} values={values} data={data} />
      </CardContent>
    </Card>
  );
}
