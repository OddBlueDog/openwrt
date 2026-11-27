// Opening a port: a port forward (fw4 redirect, DNAT from the internet zone)
// edited in a side sheet. It starts from the device, offers common
// services, reserves the device's address so the forward keeps working, and
// shows the section as /etc/config/firewall will hold it. Its form and
// checks are forward-form.ts's; the sheet closes once the save went through
// and keeps the failure on screen when it didn't.
import { ChevronRightIcon, Trash2Icon, TriangleAlertIcon } from 'lucide-react';
import { type ReactElement, useId, useMemo, useState } from 'react';
import { EditorSheet } from '@/components/editor-sheet';
import { FormField, SelectField, TextField } from '@/components/form';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { Change } from '@/lib/api/uci';
import { formErrors } from '@/lib/form/errors';
import { useSheetForm } from '@/lib/form/use-sheet-form';
import { type FirewallData, unreservedDevice } from '../firewall/api';
import { isInternetZone, isIpv4, type Redirect, wanZone, zonePhrase, zoneTitle } from '../firewall/model';
import { DeviceSelect, SwitchRow } from '../firewall/parts';
import { UciPreview } from '../firewall/sheet-parts';
import { formOf, forwardChanges, forwardFormSchema, presets, protoLabels, protos, ROUTER, servicesReached } from './forward-form';

/** "I understand", for a choice that opens more than it seems to. */
function Understood({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }): ReactElement {
  return (
    <label className="mt-1 flex min-h-6 items-center gap-2 font-medium text-foreground">
      <input
        type="checkbox"
        className="size-4 accent-primary"
        checked={checked}
        onChange={(e) => {
          onChange(e.target.checked);
        }}
      />
      I understand
    </label>
  );
}

export function ForwardSheet({
  forward,
  data,
  onClose,
  onSubmit,
  onDelete,
}: {
  forward: Redirect | undefined;
  data: FirewallData;
  onClose: () => void;
  /** applies the changes; the failure's message when that didn't go through */
  onSubmit: (changes: Change[]) => Promise<string | undefined>;
  /** asks first, then deletes the forward (an existing one only) */
  onDelete?: (() => void) | undefined;
}): ReactElement {
  const id = useId();
  const schema = useMemo(() => forwardFormSchema(forward, data), [forward, data]);
  const saved = useMemo(() => formOf(forward, data), [forward, data]);
  const {
    settings,
    values: f,
    failed,
    submitting,
  } = useSheetForm({
    schema,
    saved,
    submit: (values) => onSubmit(forwardChanges(values, forward, data)),
  });
  const { form } = settings;
  const [more, setMore] = useState(
    () => saved.srcIp !== '' || !saved.reflection || saved.dmz || saved.src !== (wanZone(data.cfg)?.name ?? 'wan'),
  );
  // the checks as they stand, whatever was touched: Save stays off until they pass
  const errors = formErrors(schema, f);
  const device = f.ip === ROUTER ? undefined : unreservedDevice(data, f.ip);
  const fromInternet = data.cfg.zones.some((z) => z.name === f.src && isInternetZone(z));
  const from = fromInternet ? 'the internet' : zonePhrase(f.src, 'src', data.cfg);
  const services = servicesReached(f);
  const section = forward === undefined ? undefined : data.sections.find((s) => s['.name'] === forward.section);
  const valid = Object.keys(errors).length === 0;
  const missing = [
    f.ip === '' ? 'the device' : undefined,
    f.name.trim() === '' ? 'a name' : undefined,
    !f.dmz && f.extPort === '' ? 'the internet port' : undefined,
  ].filter((x) => x !== undefined);
  const changes = forwardChanges(f, forward, data);
  // a field nobody has typed in yet isn't wrong yet: Save just stays off until it's filled
  const filled = (value: string): boolean => value !== '';

  return (
    <EditorSheet
      title={forward === undefined ? 'Open a port' : (forward.name ?? 'Edit port forward')}
      description={
        fromInternet
          ? 'Connections from the internet to your router on this port go on to the device you choose.'
          : `Connections from ${zonePhrase(f.src, 'src', data.cfg)} to the router on this port go on to the device you choose.`
      }
      onClose={onClose}
      status={
        <>
          {forward !== undefined && onDelete !== undefined && (
            <Button variant="ghost" className="-ml-2 text-destructive hover:text-destructive" onClick={onDelete}>
              <Trash2Icon /> Delete
            </Button>
          )}
          {failed !== undefined && <p className="text-xs font-medium text-destructive">{failed}</p>}
          {failed === undefined && !valid && (
            <p className="text-xs text-muted-foreground">
              {missing.length > 0
                ? `Still needed: ${new Intl.ListFormat('en-GB').format(missing)}.`
                : 'Fix what’s marked to save.'}
            </p>
          )}
        </>
      }
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={f.dmz ? 'destructive' : 'default'}
            disabled={!valid || submitting || (forward !== undefined && changes.length === 0)}
            onClick={settings.save}
          >
            {forward === undefined ? 'Open the port' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5 px-6 py-5">
        {forward === undefined && (
          <div className="grid gap-2">
            <span id={`${id}-presets`} className="text-sm font-medium">
              Common services
            </span>
            <div className="flex flex-wrap gap-1.5" role="group" aria-labelledby={`${id}-presets`}>
              {presets.map((p) => {
                const picked = f.name === p.name && f.extPort === p.port && f.proto === p.proto;
                return (
                  <button
                    key={p.label}
                    type="button"
                    aria-pressed={picked}
                    onClick={() => {
                      form.setFieldValue('name', p.name);
                      form.setFieldValue('proto', p.proto);
                      form.setFieldValue('extPort', p.port);
                      form.setFieldValue('intPort', p.port);
                    }}
                    className={
                      picked
                        ? 'h-8 rounded-md border border-primary bg-primary-subtle px-2.5 text-xs font-medium text-primary-subtle-foreground'
                        : 'h-8 rounded-md border bg-card px-2.5 text-xs text-foreground hover:bg-accent'
                    }
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <form.Field name="ip">
          {(field) => (
            <FormField field={field} id={`${id}-device`} label="Device" layout="stacked" showError={filled(f.ip)}>
              {(control) => (
                <>
                  {f.manual ? (
                    <Input
                      {...control}
                      className="font-mono"
                      value={field.state.value}
                      placeholder="192.168.1.20"
                      onChange={(e) => {
                        field.handleChange(e.target.value.trim());
                      }}
                      onBlur={field.handleBlur}
                    />
                  ) : (
                    <DeviceSelect
                      id={control.id}
                      devices={data.devices.filter((d) => d.ip !== undefined && isIpv4(d.ip) && d.ip !== data.routerIp)}
                      value={field.state.value}
                      by="ip"
                      extra={[{ value: ROUTER, label: 'This router' }]}
                      onChange={(v) => {
                        field.handleChange(v);
                      }}
                    />
                  )}
                  <button
                    type="button"
                    className="min-h-6 w-fit text-xs link underline-offset-4"
                    onClick={() => {
                      const manual = form.getFieldValue('manual');
                      const ip = form.getFieldValue('ip');
                      form.setFieldValue('manual', !manual);
                      form.setFieldValue('ip', manual ? '' : ip === ROUTER ? '' : ip);
                    }}
                  >
                    {f.manual ? 'Choose from your devices' : 'Type an address instead'}
                  </button>
                </>
              )}
            </FormField>
          )}
        </form.Field>
        {device !== undefined && errors['ip'] === undefined && (
          <SwitchRow
            id={`${id}-reserve`}
            boxed
            checked={f.reserve}
            onChange={(v) => {
              form.setFieldValue('reserve', v);
            }}
            title={`Keep ${f.ip} for ${device.name ?? 'this device'}`}
            hint="So the device gets the same address every time and the forward keeps working."
            why="Reserves the address as the Clients page does: a host entry in /etc/config/dhcp with the device’s MAC address. Without it, the device can get another address and the forward then goes nowhere."
          />
        )}
        <form.Field name="name">
          {(field) => (
            <TextField
              field={field}
              id={`${id}-name`}
              label="Name"
              layout="stacked"
              showError={filled(f.name)}
              placeholder="Minecraft server"
            />
          )}
        </form.Field>
        {!f.dmz && (
          <div className="grid gap-1.5">
            <div className="grid gap-3 sm:grid-cols-3">
              <form.Field name="proto">
                {(field) => (
                  <SelectField
                    field={field}
                    id={`${id}-proto`}
                    label="Protocol"
                    layout="stacked"
                    options={protos.map((k) => ({ value: k, label: protoLabels[k] }))}
                  />
                )}
              </form.Field>
              <form.Field name="extPort">
                {(field) => (
                  <FormField field={field} id={`${id}-ext`} label="Internet port" layout="stacked" showError={filled(f.extPort)}>
                    {(control) => (
                      <Input
                        {...control}
                        inputMode="numeric"
                        className="tabular"
                        value={field.state.value}
                        placeholder="25565"
                        onChange={(e) => {
                          const extPort = e.target.value.trim();
                          const intPort = form.getFieldValue('intPort');
                          // the device's port follows while it's empty or the same
                          if (intPort === '' || intPort === field.state.value) form.setFieldValue('intPort', extPort);
                          field.handleChange(extPort);
                        }}
                        onBlur={field.handleBlur}
                      />
                    )}
                  </FormField>
                )}
              </form.Field>
              <form.Field name="intPort">
                {(field) => (
                  <TextField
                    field={field}
                    id={`${id}-int`}
                    label="Device port"
                    layout="stacked"
                    showError={filled(f.intPort)}
                    inputMode="numeric"
                    className="tabular"
                    placeholder={f.extPort === '' ? 'same' : f.extPort}
                    trim
                  />
                )}
              </form.Field>
            </div>
            <p className="text-xs text-muted-foreground">
              The app’s or game’s help lists them. A range like 27015-27030 works too.
            </p>
            <p className="text-xs text-muted-foreground">
              Open only what it needs: anyone on the internet can reach each open port.
            </p>
          </div>
        )}
        {services.length > 0 && (
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertTitle>
              This opens the router’s {new Intl.ListFormat('en-GB').format(services)} to {from}
            </AlertTitle>
            <AlertDescription>
              Anyone there can reach it and try its login. To reach the router from outside, a VPN such as WireGuard is safer.
              <Understood
                checked={f.routerConfirmed}
                onChange={(v) => {
                  form.setFieldValue('routerConfirmed', v);
                }}
              />
            </AlertDescription>
          </Alert>
        )}
        <div className="flex flex-col gap-4">
          <button
            type="button"
            aria-expanded={more}
            aria-controls={`${id}-more`}
            className="flex min-h-6 w-fit items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground"
            onClick={() => {
              setMore((m) => !m);
            }}
          >
            <ChevronRightIcon
              className={
                more ? 'size-4 rotate-90 transition-transform duration-fast' : 'size-4 transition-transform duration-fast'
              }
            />{' '}
            More settings
          </button>
          <div id={`${id}-more`} hidden={!more} className="grid gap-5 border-l-2 pl-4">
            <form.Field name="srcIp">
              {(field) => (
                <TextField
                  field={field}
                  id={`${id}-src-ip`}
                  label="Only from"
                  layout="stacked"
                  hint="The one address or network allowed to connect, e.g. a friend’s. Empty: anyone."
                  why="Writes src_ip. fw4 takes one address or network here; for several, add a traffic rule on the Firewall page instead."
                  showError={filled(f.srcIp)}
                  className="font-mono"
                  placeholder="Anyone"
                />
              )}
            </form.Field>
            <SwitchRow
              id={`${id}-reflection`}
              checked={f.reflection}
              onChange={(v) => {
                form.setFieldValue('reflection', v);
              }}
              title="Works from home too (NAT loopback)"
              hint="Devices at home can use your internet address and this port, as friends outside do."
              why="Off, it works from outside only. Writes reflection '0' when off; on is fw4’s default, so the option is left unset."
            />
            <form.Field name="src">
              {(field) => (
                <SelectField
                  field={field}
                  id={`${id}-src`}
                  label="Comes from"
                  layout="stacked"
                  hint="The zone the connections arrive from: the internet, usually."
                  why="Writes src, the firewall zone; the internet zone is OpenWrt’s wan."
                  options={[
                    ...data.cfg.zones.map((z) => ({ value: z.name, label: zoneTitle(z.name, data.cfg) })),
                    ...(data.cfg.zones.some((z) => z.name === f.src) ? [] : [{ value: f.src, label: f.src }]),
                  ]}
                />
              )}
            </form.Field>
            <SwitchRow
              id={`${id}-dmz`}
              checked={f.dmz}
              onChange={(v) => {
                form.setFieldValue('dmz', v);
                form.setFieldValue('dmzConfirmed', false);
              }}
              title="Every port (DMZ)"
              hint="Forwards all traffic the router doesn’t handle itself to this device."
              why="Writes proto 'all' with no ports: every connection from the internet that isn’t a reply or another forward goes to the device."
            />
            {f.dmz && f.ip === ROUTER && (
              <Alert variant="destructive">
                <TriangleAlertIcon />
                <AlertTitle>The router can’t be the DMZ</AlertTitle>
                <AlertDescription>
                  That would open its login and every service on it to {from}. Choose a device, or forward just the ports a
                  service on the router needs.
                </AlertDescription>
              </Alert>
            )}
            {f.dmz && f.ip !== ROUTER && (
              <Alert variant="destructive">
                <TriangleAlertIcon />
                <AlertTitle>The whole device is open to {from}</AlertTitle>
                <AlertDescription>
                  Every service on it can be reached and attacked by anyone there. Forward just the ports it needs instead if you
                  can.
                  <Understood
                    checked={f.dmzConfirmed}
                    onChange={(v) => {
                      form.setFieldValue('dmzConfirmed', v);
                    }}
                  />
                </AlertDescription>
              </Alert>
            )}
          </div>
        </div>
        {fromInternet && (
          <p className="text-xs text-muted-foreground">
            To test it, connect from outside, e.g. a phone on mobile data: from home it only works with NAT loopback.
          </p>
        )}
      </div>
      <div className="border-t px-6 py-5">
        <UciPreview type="redirect" original={section} changes={changes} />
      </div>
    </EditorSheet>
  );
}
