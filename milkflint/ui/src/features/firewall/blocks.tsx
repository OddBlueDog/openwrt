// Blocking a device from the internet: a traffic rule for its MAC address
// (any zone to the internet, everything, reject), always or at set times.
import { ShieldBanIcon } from 'lucide-react';
import { type ReactElement, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { Change } from '@/lib/api/uci';
import type { FirewallData } from './api';
import { type ScheduleForm, scheduleError, scheduleForm, scheduleValues } from './forms';
import { editSection, isDeviceBlock, isMac, isShortName, type Rule, wanZone } from './model';
import { DeviceSelect, DialogField, ScheduleFields, Segmented } from './parts';

interface BlockForm {
  mac: string;
  manual: boolean;
  scheduled: boolean;
  schedule: ScheduleForm;
}

export function BlockDialog({
  rule,
  data,
  onClose,
  onSave,
}: {
  rule: Rule | undefined;
  data: FirewallData;
  onClose: () => void;
  onSave: (changes: Change[]) => void;
}): ReactElement {
  const initialMac = rule?.srcMac[0] ?? '';
  const [f, setF] = useState<BlockForm>(() => ({
    mac: initialMac,
    manual: initialMac !== '' && !data.devices.some((d) => d.mac === initialMac),
    scheduled: rule?.schedule !== undefined,
    schedule: scheduleForm(rule?.schedule),
  }));
  const blocked = new Set(data.cfg.rules.filter((r) => r.section !== rule?.section && isDeviceBlock(r, data.cfg)).flatMap((r) => r.srcMac));
  const mac = f.mac.trim().toLowerCase();
  const macError = mac === '' ? 'Choose a device.' : !isMac(mac) ? 'A MAC address like a4:83:e7:12:34:56.' : blocked.has(mac) ? 'That device is blocked already.' : undefined;
  const schedError = f.scheduled ? scheduleError(f.schedule) : undefined;
  const device = data.devices.find((d) => d.mac === mac);
  const section = rule === undefined ? undefined : data.sections.find((s) => s['.name'] === rule.section);
  const wan = wanZone(data.cfg)?.name ?? 'wan';

  // the name a device gave itself, unless it's too long or odd for a rule name: then its MAC
  const label = device?.name !== undefined && isShortName(`Block ${device.name}`) ? device.name : mac;

  const save = (): void => {
    onSave(
      editSection('rule', section, {
        name: `Block ${label}`,
        src: '*',
        dest: wan,
        src_mac: mac,
        proto: 'all',
        target: 'REJECT',
        ...scheduleValues(f.scheduled ? f.schedule : undefined),
      }),
    );
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{rule === undefined ? 'Block a device' : 'Edit block'}</DialogTitle>
          <DialogDescription>It stays on your Wi-Fi and network, and can still reach your other devices, but not the internet.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <DialogField id="block-device" label="Device" error={macError === 'Choose a device.' ? undefined : macError}>
            {f.manual ? (
              <Input
                id="block-device"
                className="font-mono"
                value={f.mac}
                placeholder="a4:83:e7:12:34:56"
                aria-invalid={macError !== undefined && mac !== ''}
                onChange={(e) => {
                  setF((x) => ({ ...x, mac: e.target.value }));
                }}
              />
            ) : (
              <DeviceSelect
                id="block-device"
                devices={data.devices.filter((d) => !blocked.has(d.mac))}
                value={mac}
                by="mac"
                onChange={(v) => {
                  setF((x) => ({ ...x, mac: v }));
                }}
              />
            )}
            <button
              type="button"
              className="w-fit text-xs text-primary underline-offset-4 hover:underline"
              onClick={() => {
                setF((x) => ({ ...x, manual: !x.manual, mac: '' }));
              }}
            >
              {f.manual ? 'Choose from your devices' : 'Type a MAC address instead'}
            </button>
          </DialogField>
          <div className="grid gap-1.5">
            <span className="text-sm font-medium">When</span>
            <Segmented<'always' | 'schedule'>
              label="When"
              value={f.scheduled ? 'schedule' : 'always'}
              onChange={(v) => {
                setF((x) => ({ ...x, scheduled: v === 'schedule' }));
              }}
              options={[
                { value: 'always', label: 'Always' },
                { value: 'schedule', label: 'At set times' },
              ]}
            />
          </div>
          {f.scheduled && (
            <ScheduleFields
              id="block-schedule"
              value={f.schedule}
              onChange={(s) => {
                setF((x) => ({ ...x, schedule: s }));
              }}
            />
          )}
          <p className="text-xs text-muted-foreground">
            New connections are blocked at once; ones already open (a video playing) can carry on until they end. Phones that use a private
            (random) Wi-Fi address for your network keep it, so this still finds them.
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={macError !== undefined || schedError !== undefined} onClick={save}>
            <ShieldBanIcon /> {rule === undefined ? 'Block' : 'Save & apply'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
