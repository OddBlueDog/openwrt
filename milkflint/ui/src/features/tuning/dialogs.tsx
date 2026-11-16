// Performance tuning's dialogs: what a save that turns hardware offloading
// (WED) on or off changes besides, and what Restore defaults puts back.
import type { ReactElement } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { isGuestShaper } from '../wifi-guest/guest';
import { aqlTotalValue, ecnDropLabel, l4sLabel, retriesLabel, rxDelayLabel, voAggrLabel } from './knobs';
import {
  aqlLabel,
  aqlTotalLabel,
  defaults,
  groChanged,
  groLabels,
  queueSwitch,
  sizeLabel,
  steeringOptions,
  type TuningData,
} from './model';
import { speedsText, wedEffects, wedRestores } from './wed';

/** "Smart Queue on eth1 (600 / 60 Mbit/s)", "a guest network’s speed limit (25 Mbit/s down)" */
function queueText(q: { device: string; download: number; upload: number }): string {
  // on a guest network's bridge the queue's upload is what its devices download
  const speeds = isGuestShaper(q.device) ? speedsText(q.upload, q.download) : speedsText(q.download, q.upload);
  const what = isGuestShaper(q.device) ? 'A guest network’s speed limit' : `Smart Queue on ${q.device}`;
  return speeds === '' ? what : `${what} (${speeds})`;
}

/** What connections the hardware forwards pass by, in the words of the pages that set it. */
const passedBy = [
  'Smart Queue: shaping, fairness between devices, ECN and L4S marking, the ACK filter and restored DSCP.',
  'The Wi-Fi’s queue limits (AQL) and its queues that send small flows first, on the way to a device.',
  'Airtime fairness: each device’s weight, limit, tries and pacing. It also can’t tell delivered frames from failed ones while WED is on, so it judges devices by less.',
  'The Wi-Fi priority map: the Wi-Fi chip picks the priority class of a download by itself.',
  'Sends per frame, and the hold of a phone that stops answering, which doesn’t work at all with WED on.',
  'Packet steering, receive interrupts and GRO: nothing of these connections reaches a CPU.',
  'Live rates on the Dashboard and Wi-Fi pages can read low, and Data Statistics counts them a few seconds behind and less exactly.',
];

/**
 * Before a save that turns hardware offloading with WED on or off: what it
 * changes besides, what stops applying, and the restart it takes.
 */
export function WedDialog({
  to,
  data,
  onCancel,
  onSave,
}: {
  /** turning it on or off; undefined: closed */
  to: boolean | undefined;
  data: TuningData;
  onCancel: () => void;
  onSave: (restart: boolean) => void;
}): ReactElement {
  const effects = wedEffects(data.wed);
  const restores = wedRestores(data.wed);
  return (
    <Dialog
      open={to !== undefined}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{to === true ? 'Turn hardware offloading (WED) on?' : 'Turn hardware offloading (WED) off?'}</DialogTitle>
          <DialogDescription>
            {to === true
              ? 'The router’s chip then forwards established connections by itself. That is the fastest and lightest way through the router, and it passes by what keeps latency low.'
              : 'Connections go through the router’s software again, and what WED turned off comes back.'}
          </DialogDescription>
        </DialogHeader>
        {to === true ? (
          <div className="flex flex-col gap-3 text-sm">
            <div>
              <p className="font-medium">Turned off, and back on when WED is turned off:</p>
              <ul className="list-disc pl-5 text-muted-foreground">
                {effects.queues.length === 0 ? (
                  <li>Nothing: Smart Queue and the guest speed limits are off already.</li>
                ) : (
                  effects.queues.map((q) => <li key={q.section}>{queueText(q)}</li>)
                )}
              </ul>
            </div>
            {(effects.offload || effects.offloadHw) && (
              <div>
                <p className="font-medium">Turned on, which WED needs:</p>
                <ul className="list-disc pl-5 text-muted-foreground">
                  {effects.offload && <li>The firewall’s software flow offloading.</li>}
                  {effects.offloadHw && <li>The firewall’s hardware flow offloading, for wired connections too.</li>}
                </ul>
              </div>
            )}
            <div>
              <p className="font-medium">No longer applied to connections the hardware forwards:</p>
              <ul className="list-disc pl-5 text-muted-foreground">
                {passedBy.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
            <p className="text-muted-foreground">
              Unchanged: the firewall’s rules and port forwards, blocked devices, guest isolation, VPNs (their traffic stays in
              software), DNS and the rest of the Wi-Fi settings.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3 text-sm">
            <div>
              <p className="font-medium">Put back as they were:</p>
              <ul className="list-disc pl-5 text-muted-foreground">
                {restores.queues.map((q) => (
                  <li key={q.section}>
                    {isGuestShaper(q.device) ? 'A guest network’s speed limit' : `Smart Queue on ${q.device}`}, with its settings.
                  </li>
                ))}
                {restores.offloadHw === false && <li>The firewall’s hardware flow offloading: off.</li>}
                {restores.queues.length === 0 && restores.offloadHw === undefined && <li>Nothing else was changed by it.</li>}
              </ul>
            </div>
          </div>
        )}
        <p className="text-sm text-muted-foreground">
          The Wi-Fi driver takes the change when the router restarts: everything is offline for a minute or two, Wi-Fi a little
          longer on channels that check for radar first. The rest applies at once.
        </p>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              onSave(false);
            }}
          >
            Save, restart later
          </Button>
          <Button
            onClick={() => {
              onSave(true);
            }}
          >
            Save and restart
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Before Restore defaults: each setting's default, and what it is now where that differs. */
export function RestoreDialog({
  open,
  data,
  dirty,
  onCancel,
  onRestore,
}: {
  open: boolean;
  data: TuningData | undefined;
  /** the page has unsaved changes, which restoring drops */
  dirty: boolean;
  onCancel: () => void;
  onRestore: () => void;
}): ReactElement {
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onCancel();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Restore the defaults?</DialogTitle>
          <DialogDescription>
            They go back to what MilkFlint ships with, and the router applies them straight away. Wi-Fi and the internet stay up.
          </DialogDescription>
        </DialogHeader>
        {data !== undefined && (
          <ul className="flex flex-col gap-2 text-sm">
            <RestoreItem
              label="Wi-Fi queue"
              to={aqlLabel(defaults)}
              from={data.form.aql === 'default' ? undefined : aqlLabel(data.form)}
            />
            <RestoreItem
              label="Wi-Fi radio’s total"
              to={aqlTotalLabel(defaults)}
              from={
                aqlTotalValue(data.form.aqlTotal, data.form.aqlTotalCustom) === undefined && data.form.aql === 'default'
                  ? undefined
                  : aqlTotalLabel(data.form)
              }
            />
            <RestoreItem
              label="Wi-Fi sends per frame"
              to={retriesLabel(defaults.retries)}
              from={data.form.retries === defaults.retries ? undefined : retriesLabel(data.form.retries)}
            />
            <RestoreItem
              label="Voice queue aggregation"
              to={voAggrLabel(defaults.voAggr)}
              from={data.form.voAggr === defaults.voAggr ? undefined : voAggrLabel(data.form.voAggr)}
            />
            <RestoreItem
              label="Packet steering"
              to={steeringOptions[defaults.steering].label}
              from={data.form.steering === defaults.steering ? undefined : steeringOptions[data.form.steering].label}
            />
            <RestoreItem
              label="Smart Queue marks L4S traffic"
              to={l4sLabel(defaults.l4s, data.sqm?.targetMs ?? null)}
              from={data.form.l4s === defaults.l4s ? undefined : l4sLabel(data.form.l4s, data.sqm?.targetMs ?? null)}
            />
            <RestoreItem label="Wi-Fi threads on every CPU" to="On" from={data.form.wifiAll ? undefined : 'Off'} />
            <RestoreItem label="Internet receive threads first" to="On" from={data.form.ringsRt ? undefined : 'Off'} />
            <RestoreItem
              label="Longest receive interrupt delay"
              to={rxDelayLabel(defaults.rxDelay)}
              from={data.form.rxDelay === defaults.rxDelay ? undefined : rxDelayLabel(data.form.rxDelay)}
            />
            <RestoreItem
              label="Smart Queue drops from downloads that ignore ECN marks"
              to={ecnDropLabel(defaults.ecnDrop)}
              from={data.form.ecnDrop === defaults.ecnDrop ? undefined : ecnDropLabel(data.form.ecnDrop)}
            />
            {data.firewall !== undefined && (
              <RestoreItem label="Software flow offloading" to="On" from={data.form.offload ? undefined : 'Off'} />
            )}
            {data.form.wed && (
              <RestoreItem label="Hardware offloading (WED)" to="Off, with a restart: you’re asked first" from="On" />
            )}
            {queueSwitch(defaults, data) !== undefined && (
              <RestoreItem label="Smart Queue" to="multi-queue CAKE" from="single-queue CAKE" />
            )}
            {groChanged(data.form) && (
              <>
                <RestoreItem
                  label="GRO"
                  to={groLabels[defaults.gro]}
                  from={data.form.gro === defaults.gro ? undefined : groLabels[data.form.gro]}
                />
                <RestoreItem
                  label="UDP GRO forwarding"
                  to="Automatic"
                  from={data.form.udpFwd === defaults.udpFwd ? undefined : data.form.udpFwd === 'on' ? 'On' : 'Off'}
                />
                <RestoreItem
                  label="Largest GRO packet"
                  to="Automatic"
                  from={data.form.groMax === '' ? undefined : sizeLabel(data.form.groMax)}
                />
                <RestoreItem
                  label="Smart Queue takes GRO packets whole"
                  to="Automatic: from 500 Mbit/s"
                  from={data.form.whole === defaults.whole ? undefined : data.form.whole === 'on' ? 'Always' : 'Never'}
                />
              </>
            )}
          </ul>
        )}
        {dirty && <p className="text-sm text-muted-foreground">Your unsaved changes on this page are dropped.</p>}
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={onRestore}>Restore defaults</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RestoreItem({ label, to, from }: { label: string; to: string; from: string | undefined }): ReactElement {
  return (
    <li className="flex flex-col">
      <span>
        <span className="font-medium">{label}:</span> {to}
      </span>
      <span className="text-xs text-muted-foreground">{from === undefined ? 'already the default' : `now ${from}`}</span>
    </li>
  );
}
