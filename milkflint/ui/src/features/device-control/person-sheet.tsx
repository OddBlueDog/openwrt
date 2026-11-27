// Adding or editing a group of devices or a single device on the Device
// control page (and the Firewall page's Block a device): a group's name, the
// devices, when their internet is off (at set times, always, or only when
// paused), Guest Wi-Fi at their times, and SafeSearch. Saving writes their
// milkflint section and their firewall rules in one apply; the Firewall
// page shows the same rules. A device only an older rule covers is taken
// over here: its rule goes, and its times become Device control's.
import { pageLink } from '@/lib/router';
import { Link } from '@tanstack/react-router';
import { InfoIcon, PlusIcon, SearchIcon, ShieldBanIcon, Trash2Icon, TriangleAlertIcon, XIcon } from 'lucide-react';
import { evaluate, useSelector } from '@tanstack/react-form';
import { type ReactElement, useId, useMemo, useState } from 'react';
import { formErrors } from '@/lib/form/errors';
import { useFormValues, useSettingsForm } from '@/lib/form/use-settings-form';
import { EditorSheet } from '@/components/editor-sheet';
import { Note } from '@/components/note';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Segmented } from '@/components/ui/segmented';
import type { Change, Section } from '@/lib/api/uci';
import { cn } from '@/lib/utils';
import type { FirewallConfig } from '../firewall/model';
import { DialogField, ScheduleFields, SwitchRow } from '../firewall/parts';
import { isMac } from '../firewall/model';
import {
  DAYS,
  type DeviceRule,
  deviceRuleText,
  newPersonId,
  oldMeaningDiffers,
  type Person,
  personChanges,
  type PersonForm,
  PRESETS,
  scheduleSummary,
  type Window,
  windowError,
  windowOfRule,
  windowText,
} from './model';
import { initialForm, type SheetForm, sheetFieldNames, sheetFormSchema, type When } from './sheet-form';
import { WeekTimeline } from './timeline';
import { type Entry, formSpans } from './view';

/** A device the picker lists. */
export interface PickDevice {
  mac: string;
  name: string | undefined;
  ip: string | undefined;
  online?: boolean;
  /** seconds since it last answered */
  seen?: number | undefined;
  privateMac: boolean;
  guest: boolean;
}

export interface SheetData {
  cfg: FirewallConfig;
  firewall: readonly Section[];
  milkflint: readonly Section[];
  people: readonly Person[];
  devices: readonly PickDevice[];
  guestZones: readonly string[];
  /** AdGuard Home: answering, installed but not answering, not in this firmware */
  adguard: 'on' | 'off' | 'none';
  /** DNS intercept on the home network */
  intercept: boolean;
}

function ago(s: number | undefined): string | undefined {
  if (s === undefined) return undefined;
  if (s < 90) return 'seen just now';
  if (s < 3600) return `seen ${String(Math.round(s / 60))} min ago`;
  if (s < 2 * 86400) return `seen ${String(Math.round(s / 3600))} h ago`;
  return `seen ${String(Math.round(s / 86400))} days ago`;
}

/** The devices as a checklist (one choice for a device on its own), with a search box once there are many. */
function DeviceChecklist({
  id,
  devices,
  chosen,
  single,
  takenBy,
  me,
  onChange,
}: {
  id: string;
  devices: readonly PickDevice[];
  chosen: readonly string[];
  single: boolean;
  /** MAC → who else has it */
  takenBy: ReadonlyMap<string, string>;
  me: string | undefined;
  onChange: (macs: string[]) => void;
}): ReactElement {
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();
  const sorted = [...devices].sort((a, b) => {
    const ca = chosen.includes(a.mac) ? 0 : 1;
    const cb = chosen.includes(b.mac) ? 0 : 1;
    if (ca !== cb) return ca - cb;
    if ((a.online ?? false) !== (b.online ?? false)) return a.online === true ? -1 : 1;
    return (a.name ?? a.ip ?? a.mac).localeCompare(b.name ?? b.ip ?? b.mac);
  });
  const shown =
    query === '' ? sorted : sorted.filter((d) => `${d.name ?? ''} ${d.ip ?? ''} ${d.mac}`.toLowerCase().includes(query));
  return (
    <div className="grid gap-2">
      {devices.length > 8 && (
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Find a device"
            placeholder="Find a device"
            className="pl-9"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
            }}
          />
        </div>
      )}
      <ul id={id} className="grid max-h-80 gap-px overflow-y-auto rounded-lg border bg-border" aria-label="Devices">
        {shown.length === 0 && <li className="bg-card px-3 py-3 text-sm text-muted-foreground">No device by that name.</li>}
        {shown.map((d) => {
          const on = chosen.includes(d.mac);
          const other = takenBy.get(d.mac);
          const details = [
            d.online === true ? 'online' : ago(d.seen),
            d.ip,
            d.guest ? 'on Guest Wi-Fi' : undefined,
            d.privateMac ? 'private address' : undefined,
            d.mac === me ? 'this device' : undefined,
            other === undefined ? undefined : `in ${other}`,
          ].filter((x) => x !== undefined);
          return (
            <li key={d.mac} className="bg-card">
              {/* the box and the dot beside both lines: its name, then online or last seen, address and notes */}
              <label
                className={cn(
                  'grid min-h-12 cursor-pointer grid-cols-[auto_auto_minmax(0,1fr)] items-center gap-x-3 px-3 py-2',
                  other !== undefined && 'cursor-not-allowed opacity-70',
                  on && 'bg-primary-subtle',
                )}
              >
                <input
                  type={single ? 'radio' : 'checkbox'}
                  name={single ? `${id}-device` : undefined}
                  className="row-span-2 size-4 shrink-0 accent-primary"
                  checked={on}
                  disabled={other !== undefined}
                  onChange={(e) => {
                    if (single) onChange([d.mac]);
                    else onChange(e.target.checked ? [...chosen, d.mac] : chosen.filter((m) => m !== d.mac));
                  }}
                />
                <span
                  aria-hidden="true"
                  className={cn(
                    'row-span-2 size-2 shrink-0 rounded-full',
                    d.online === true ? 'bg-success' : 'border border-muted-foreground',
                  )}
                />
                <span className="truncate text-sm font-medium">{d.name ?? d.ip ?? d.mac}</span>
                <span className="col-start-3 truncate text-xs text-muted-foreground">{details.join(' · ')}</span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function PersonSheet({
  data,
  entry,
  kind,
  me,
  deviceName,
  initialDevices,
  blocking = false,
  onClose,
  onSave,
  onSubmit,
  onDelete,
}: {
  data: SheetData;
  /** a new one's devices to start with (#/device-control/<mac>) */
  initialDevices?: readonly string[] | undefined;
  /** undefined: someone new */
  entry: Entry | undefined;
  /** a group of devices (with a name) or a single device */
  kind: 'person' | 'device';
  /** opened to block a device (the Firewall page's Block a device): says Block, and starts on always */
  blocking?: boolean;
  /** this device's MAC */
  me: string | undefined;
  deviceName: (mac: string) => string | undefined;
  onClose: () => void;
  /** hands the changes over; the caller closes the sheet (the Firewall page's Block a device) */
  onSave?: ((changes: Change[]) => void) | undefined;
  /** applies the changes; the failure's message when that didn't go through (the sheet stays open with it) */
  onSubmit?: ((changes: Change[]) => Promise<string | undefined>) | undefined;
  onDelete?: (() => void) | undefined;
}): ReactElement {
  const id = useId();
  // a device on its own: one device, named by it
  const single =
    entry === undefined
      ? kind === 'device'
      : entry.person !== undefined
        ? entry.person.name === undefined
        : entry.macs.length === 1;
  // what it opened with: the form's saved settings
  const [start] = useState<SheetForm>(() => {
    const first = initialForm(entry, single ? 'device' : 'person', blocking);
    return entry === undefined && initialDevices !== undefined ? { ...first, devices: [...initialDevices] } : first;
  });
  const schema = useMemo(() => sheetFormSchema(single), [single]);
  const [failed, setFailed] = useState<string>();
  const settings = useSettingsForm({
    schema,
    saved: start,
    onSave: async (values) => {
      const changes = changesOf(values);
      if (onSubmit !== undefined) setFailed(await onSubmit(changes));
      else onSave?.(changes);
    },
  });
  const { form } = settings;
  const f = useFormValues(form);
  const submitting = useSelector(form.store, (x) => x.isSubmitting);
  // the sheet's own controls change the form through this, a field at a time
  const setF = (update: (x: SheetForm) => SheetForm): void => {
    const current = form.store.state.values;
    const next = update(current);
    for (const key of sheetFieldNames) {
      if (!evaluate(current[key], next[key])) form.setFieldValue(key, next[key]);
    }
  };
  const isNew = entry === undefined;
  const taking = entry !== undefined && entry.person === undefined;

  const takenBy = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of data.people) {
      if (p.id === entry?.person?.id) continue;
      for (const d of p.devices) m.set(d, p.name ?? deviceName(d) ?? d);
    }
    return m;
  }, [data.people, entry, deviceName]);

  // devices typed in by MAC (not on the network now) are listed too
  const known = new Set(data.devices.map((d) => d.mac));
  const listed: PickDevice[] = [
    ...data.devices,
    ...f.devices
      .filter((m) => !known.has(m))
      .map((mac) => ({
        mac,
        name: deviceName(mac),
        ip: undefined,
        privateMac: (parseInt(mac.slice(0, 2), 16) & 2) !== 0,
        guest: false,
      })),
  ];

  const manual = f.manual.trim().toLowerCase();
  const manualError =
    manual === ''
      ? undefined
      : !isMac(manual)
        ? 'A MAC address like a4:83:e7:12:34:56.'
        : takenBy.has(manual)
          ? `It’s in ${takenBy.get(manual) ?? ''} already.`
          : undefined;

  // the checks as they stand: the first one to fix holds the save back
  const errors = formErrors(schema, f);
  const nameError = errors['name'];
  const devicesError = errors['devices'];
  const timesError = errors['windows'];
  const windowErrors = f.windows.map((_, i) => errors[`windows[${String(i)}]`]);
  const blocked = nameError ?? devicesError ?? timesError ?? windowErrors.find((e) => e !== undefined);

  const personFormOf = (x: SheetForm): PersonForm => ({
    name: single ? undefined : x.name.trim(),
    devices: x.devices,
    windows: x.when === 'times' ? x.windows : [],
    always: x.when === 'always',
    safeSearch: x.safeSearch,
    guest: x.guest && x.when === 'times',
  });
  const personForm = personFormOf(f);
  const preview = formSpans(personForm.windows, personForm.always);

  function changesOf(x: SheetForm): Change[] {
    const taken = new Set([...data.firewall, ...data.milkflint].map((s) => s['.name']));
    const pid = entry?.person?.id ?? newPersonId(taken);
    const ctx = { cfg: data.cfg, firewall: data.firewall, milkflint: data.milkflint, deviceName };
    return [
      // older rules taken over go first, so the new rules never sit beside them
      ...x.takeOver.map((section): Change => ({ op: 'delete', config: 'firewall', section })),
      ...personChanges(pid, personFormOf(x), ctx),
    ];
  }

  const olderOfPerson: DeviceRule[] = entry?.person === undefined ? [] : entry.older;
  const privateOnes = f.devices.filter((m) => listed.find((d) => d.mac === m)?.privateMac === true);
  const changedMeaning = taking ? entry.older.filter(oldMeaningDiffers) : [];
  const title = isNew
    ? single
      ? blocking
        ? 'Block a device'
        : 'Add a single device'
      : 'Add a group of devices'
    : `Edit ${entry.title}`;

  return (
    <EditorSheet
      title={title}
      description={
        single
          ? 'When this device may use the internet. It stays on your network either way.'
          : 'Devices that share one set of times, such as one person’s or the games consoles. They stay on your network either way.'
      }
      onClose={onClose}
      status={
        failed !== undefined ? (
          <span className="text-xs font-medium text-destructive">{failed}</span>
        ) : onDelete !== undefined ? (
          <Button variant="ghost" className="text-destructive" onClick={onDelete}>
            <Trash2Icon /> Delete
          </Button>
        ) : blocked !== undefined && blocked !== devicesError && blocked !== nameError ? (
          <span className="text-xs text-muted-foreground">{blocked}</span>
        ) : undefined
      }
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={blocked !== undefined || submitting} onClick={settings.save}>
            {isNew && single && blocking ? <ShieldBanIcon /> : null}
            {isNew ? (single && blocking ? 'Block' : 'Add') : 'Save'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-6 px-6 py-5">
        {taking && (
          <Note tone="info" icon={<InfoIcon />} title="Made on the Firewall page">
            Saving moves it here: its rule is replaced by Device control’s, with the times below.
            {changedMeaning.length > 0 &&
              ` Over midnight the days now mean the nights you picked (${changedMeaning.map(deviceRuleText).join('; ')} before).`}
          </Note>
        )}

        {!single && (
          <DialogField id={`${id}-name`} label="Group name" error={f.name === '' ? undefined : nameError}>
            <Input
              id={`${id}-name`}
              value={f.name}
              maxLength={32}
              autoComplete="off"
              placeholder="Sam, or Games consoles"
              onChange={(e) => {
                setF((x) => ({ ...x, name: e.target.value }));
              }}
            />
          </DialogField>
        )}

        <div className="grid gap-2">
          <Label htmlFor={`${id}-devices`}>{single ? 'Device' : 'Devices'}</Label>
          <DeviceChecklist
            id={`${id}-devices`}
            devices={listed}
            chosen={f.devices}
            single={single}
            takenBy={takenBy}
            me={me}
            onChange={(devices) => {
              setF((x) => ({ ...x, devices }));
            }}
          />
          <div className="flex flex-wrap items-start gap-2">
            <Input
              aria-label="A device’s MAC address"
              className="w-56 font-mono"
              placeholder="Or type a MAC address"
              value={f.manual}
              aria-invalid={manualError !== undefined}
              onChange={(e) => {
                setF((x) => ({ ...x, manual: e.target.value }));
              }}
            />
            <Button
              variant="outline"
              disabled={manual === '' || manualError !== undefined}
              onClick={() => {
                setF((x) => ({ ...x, devices: single ? [manual] : [...new Set([...x.devices, manual])], manual: '' }));
              }}
            >
              <PlusIcon /> Add
            </Button>
          </div>
          {manualError !== undefined && <p className="text-xs font-medium text-destructive">{manualError}</p>}
          {privateOnes.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {new Intl.ListFormat('en-GB').format(privateOnes.map((m) => deviceName(m) ?? m))}{' '}
              {privateOnes.length === 1 ? 'uses a private Wi-Fi address' : 'use private Wi-Fi addresses'}: kept on your network,
              but new on Guest Wi-Fi, or every so often if set to rotate. In its Wi-Fi settings, set it to Fixed (iPhone, iPad) or
              to use the device’s MAC (Android).
            </p>
          )}
          {me !== undefined && f.devices.includes(me) && (
            <Note tone="warning" icon={<TriangleAlertIcon />}>
              This is the device you’re using: its times would cut this page off too.
            </Note>
          )}
        </div>

        <div className="grid gap-3">
          <span className="text-sm font-medium" id={`${id}-when`}>
            Internet off
          </span>
          <Segmented<When>
            label="Internet off"
            value={f.when}
            onChange={(when) => {
              setF((x) => ({ ...x, when }));
            }}
            options={[
              { value: 'times', label: 'At set times' },
              { value: 'always', label: 'Always' },
              { value: 'never', label: 'Only when paused' },
            ]}
          />
          {f.when === 'times' && (
            <>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Add a time">
                {PRESETS.map((p) => (
                  <Button
                    key={p.id}
                    variant="outline"
                    size="sm"
                    title={p.hint}
                    className="h-9"
                    onClick={() => {
                      form.pushFieldValue('windows', { ...p.window, days: [...p.window.days] });
                    }}
                  >
                    <PlusIcon /> {p.window.label}
                  </Button>
                ))}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9"
                  onClick={() => {
                    form.pushFieldValue('windows', { start: '18:00', stop: '19:00', days: [...DAYS], label: 'Internet off' });
                  }}
                >
                  <PlusIcon /> Other time
                </Button>
              </div>
              {f.windows.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Start from Bedtime ({PRESETS[0]?.hint}), School nights, School hours or Weekends, then change the times.
                </p>
              )}
              <ol className="grid gap-3">
                {f.windows.map((w, i) => (
                  <li key={i} className="grid gap-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm">
                        <span className="font-medium">{w.label}</span>
                        <span className="text-muted-foreground"> · {windowError(w) === undefined ? windowText(w) : '…'}</span>
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove ${w.label}`}
                        onClick={() => {
                          void form.removeFieldValue('windows', i);
                        }}
                      >
                        <XIcon />
                      </Button>
                    </div>
                    <ScheduleFields
                      id={`${id}-w${String(i)}`}
                      nights
                      value={w}
                      error={windowError(w)}
                      onChange={(s) => {
                        void form.replaceFieldValue('windows', i, {
                          ...w,
                          start: s.start,
                          stop: s.stop,
                          days: s.days as Window['days'],
                        });
                      }}
                    />
                  </li>
                ))}
              </ol>
            </>
          )}
          {f.when === 'never' && (
            <p className="text-sm text-muted-foreground">No set times: their internet goes off only when you pause it.</p>
          )}
          <div className="grid gap-2 rounded-lg bg-muted/50 p-3">
            <p className="text-sm font-medium">{scheduleSummary(personForm.windows, personForm.always)}</p>
            <WeekTimeline spans={preview} label="The week with these times: time off is filled in" />
          </div>
          {olderOfPerson.length > 0 && (
            <div className="grid gap-2">
              {olderOfPerson.map((r) => {
                const w = windowOfRule(r);
                const taken = f.takeOver.includes(r.section);
                return (
                  <Note key={r.section} tone="info" icon={<InfoIcon />} title="An older rule also covers one of their devices">
                    <span>
                      {r.name ?? r.section}: {deviceRuleText(r)}. {taken ? 'It goes when you save.' : ''}
                    </span>
                    {!taken && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-1 w-fit"
                        onClick={() => {
                          setF((x) => ({
                            ...x,
                            takeOver: [...x.takeOver, r.section],
                            ...(w === undefined ? { when: 'always' } : { when: 'times', windows: [...x.windows, w] }),
                          }));
                        }}
                      >
                        Take it over
                      </Button>
                    )}
                  </Note>
                );
              })}
            </div>
          )}
        </div>

        {data.guestZones.length > 0 && f.when === 'times' && (
          <SwitchRow
            id={`${id}-guest`}
            checked={f.guest}
            onChange={(guest) => {
              setF((x) => ({ ...x, guest }));
            }}
            title="Also stop Guest Wi-Fi at these times"
            hint="A phone that joins Guest Wi-Fi gets a new private address and slips past these times. This turns Guest Wi-Fi’s internet off for everyone on it while they’re on."
          />
        )}

        <div className="grid gap-2">
          <SwitchRow
            id={`${id}-safe`}
            checked={f.safeSearch}
            onChange={(safeSearch) => {
              setF((x) => ({ ...x, safeSearch }));
            }}
            title="SafeSearch and YouTube’s Restricted Mode"
            hint={
              data.adguard === 'on'
                ? `Google, Bing, DuckDuckGo and YouTube for ${single ? 'this device' : 'these devices'}, through AdGuard Home. Apps with their own encrypted DNS, or a VPN app, can get round it.`
                : `Just for ${single ? 'this device' : 'these devices'}, it needs AdGuard Home on. It’s kept for when it is.`
            }
          />
          {f.safeSearch && data.adguard !== 'on' && (
            <p className="text-xs text-muted-foreground">
              Without AdGuard Home, a family DNS server does it for every device instead:{' '}
              <Link {...pageLink('dns')} className="link underline-offset-4">
                DNS
              </Link>
              {data.adguard === 'off' && (
                <>
                  {' '}
                  or{' '}
                  <Link {...pageLink('adguardhome')} className="link underline-offset-4">
                    turn on AdGuard Home
                  </Link>
                </>
              )}
              .
            </p>
          )}
          {f.safeSearch && !data.intercept && (
            <p className="text-xs text-muted-foreground">
              DNS intercept is off, so a device set to its own DNS server skips it. Turn it on on the{' '}
              <Link {...pageLink('dns')} className="link underline-offset-4">
                DNS page
              </Link>
              .
            </p>
          )}
        </div>
      </div>
    </EditorSheet>
  );
}
