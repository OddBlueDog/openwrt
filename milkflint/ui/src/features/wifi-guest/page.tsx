// Guest Wi-Fi: networks of their own for visitors and smart-home devices. The
// page opens on the answer (each guest network, on or off, the devices on it
// now and the QR code to join it), then the chosen network's settings in
// tiers, with what its devices may reach and who's on it beside them. A new
// network starts from what it's for (visitors or smart home); every setting
// can change before it's saved.
import { PlusIcon, TriangleAlertIcon } from 'lucide-react';
import { useSuspenseQuery } from '@tanstack/react-query';
import { evaluate } from '@tanstack/react-form';
import { type ReactElement, useCallback, useMemo, useState } from 'react';
import { ApplyStatus } from '@/components/apply-status';
import { CardHeading } from '@/components/card-heading';
import { PageHeader } from '@/components/layout/page-header';
import { PageBoundary } from '@/components/page-boundary';
import { SaveArea } from '@/components/save-area';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useApply } from '@/hooks/use-apply';
import { useFormValues, useSettingsForm } from '@/lib/form/use-settings-form';
import { useLive } from '@/lib/query/use-live';
import { useWed } from '../tuning/use-wed';
import { WedNotice } from '../tuning/wed-notice';
import { GUEST_IDS, type GuestId } from './guest';
import { KindChoice } from './kind';
import {
  blankNet,
  type Errors,
  type GuestForm,
  guestErrors,
  guestFormSchema,
  type Kind,
  labelOf,
  type NetData,
  type NetForm,
  newForm,
  removal,
  saveWarnings,
  toChanges,
} from './model';
import { guestQueries } from './queries';
import { GuestOverview } from './overview';
import { NetworkSettings } from './settings';
import { ConnectedNow, WhatItGets } from './side';

export function GuestWifiPage(): ReactElement {
  return (
    <PageBoundary>
      <GuestWifi />
    </PageBoundary>
  );
}

function GuestWifi(): ReactElement {
  const { data } = useSuspenseQuery(guestQueries.settings());
  const [selected, setSelected] = useState<GuestId>();
  // what each network added here and not saved yet is for: its kinds stay shown to switch
  const [kinds, setKinds] = useState<Partial<Record<GuestId, Kind>>>({});
  const [adding, setAdding] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<NetData>();
  // hardware offloading with WED turns the speed limits off; setting one here turns WED off
  const wed = useWed();
  const reloadWed = wed.reload;
  const onApplied = useCallback(() => {
    setKinds({});
    reloadWed();
  }, [reloadWed]);
  const { state, apply } = useApply(onApplied);
  // the devices on every guest network, in one look at the access points
  const anySaved = data.nets.length > 0;
  const guests = useLive({ ...guestQueries.clients(), enabled: anySaved }).data;

  const saved = useMemo((): GuestForm => ({ nets: data.nets.map((n) => n.form) }), [data]);
  const schema = useMemo(() => guestFormSchema(data), [data]);
  const settings = useSettingsForm({
    schema,
    saved,
    onSave: async (values) => {
      const changes = values.nets.filter(changed).flatMap((f) => toChanges(f, netOf(f), data));
      // a speed limit is WED off: its changes first, so this page's own stand
      await apply([...(wed.on && limitAsked ? wed.offChanges() : []), ...changes]);
    },
  });
  const { form: formApi } = settings;
  const values = useFormValues(formApi);
  const forms = values.nets;
  const dirty = settings.dirty;
  const netOf = (f: NetForm): NetData => data.nets.find((n) => n.id === f.id) ?? blankNet(f, data);
  // errors once a change or a save has checked the form
  const checked = dirty || settings.invalid;
  const errorsOf = (f: NetForm): Errors => (checked ? guestErrors(values, f.id, data) : {});
  const changed = (f: NetForm): boolean =>
    !evaluate(
      f,
      saved.nets.find((s) => s.id === f.id),
    );
  const invalid = forms.some((f) => Object.keys(errorsOf(f)).length > 0);
  // a save would set a speed limit
  const limitAsked = dirty && forms.some((f) => changed(f) && (f.downMbit !== '' || f.upMbit !== ''));
  const current = forms.find((f) => f.id === selected) ?? forms[0];
  const currentNet = current === undefined ? undefined : netOf(current);
  const errors = current === undefined ? {} : errorsOf(current);
  const freeId = GUEST_IDS.find((id) => !forms.some((f) => f.id === id));
  const setUp = currentNet !== undefined && data.nets.some((n) => n.id === currentNet.id);

  const setNets = (nets: NetForm[]): void => {
    formApi.setFieldValue('nets', nets);
  };
  const update = (f: NetForm): void => {
    setNets(forms.map((o) => (o.id === f.id ? f : o)));
  };
  const add = (kind: Kind): void => {
    if (freeId === undefined) return;
    const f = newForm(freeId, kind, data, forms);
    setNets([...forms, f].sort((a, b) => GUEST_IDS.indexOf(a.id) - GUEST_IDS.indexOf(b.id)));
    setKinds((k) => ({ ...k, [f.id]: kind }));
    setSelected(f.id);
    setAdding(false);
  };
  // a network not saved yet starts again from the other kind
  const switchKind = (f: NetForm, kind: Kind): void => {
    update(
      newForm(
        f.id,
        kind,
        data,
        forms.filter((o) => o.id !== f.id),
      ),
    );
    setKinds((k) => ({ ...k, [f.id]: kind }));
  };
  const remove = (): void => {
    if (current === undefined || currentNet === undefined) return;
    if (setUp) setConfirmRemove(currentNet);
    // not saved yet: it just goes
    else setNets(forms.filter((f) => f.id !== current.id));
  };

  return (
    <>
      <PageHeader
        title="Guest Wi-Fi"
        description="Networks of their own for visitors and smart-home devices: the internet, but none of your devices."
        actions={
          forms.length > 0 &&
          freeId !== undefined && (
            <Button
              variant="outline"
              onClick={() => {
                setAdding(true);
              }}
            >
              <PlusIcon />
              Add a guest network
            </Button>
          )
        }
      />
      <div className="flex flex-col gap-4">
        {wed.on && (
          <WedNotice title="Speed limits are off: hardware offloading (WED) is on" turningOff={limitAsked}>
            {limitAsked
              ? 'A speed limit and WED can’t both run: the connections WED forwards in hardware never reach the limit’s queue.'
              : 'The router’s chip forwards established connections by itself, past a guest network’s speed limit, so the limits were turned off for it. They come back as they were when WED is turned off; setting one here turns WED off instead. Guests are still kept apart from your devices.'}
          </WedNotice>
        )}
        <ApplyStatus state={state} />
        {current === undefined || currentNet === undefined ? (
          <Card>
            <CardHeading
              title="No guest network yet"
              description="Pick what it’s for: you can change every setting before saving, and add another later."
            />
            <CardContent>
              <KindChoice label="What it’s for" onPick={add} />
            </CardContent>
          </Card>
        ) : (
          <>
            <GuestOverview
              forms={forms}
              saved={saved.nets}
              radios={data.radios}
              guests={guests}
              selected={current.id}
              onSelect={setSelected}
            />
            <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
              <NetworkSettings
                key={current.id}
                form={current}
                net={currentNet}
                data={data}
                errors={errors}
                kind={setUp ? undefined : kinds[current.id]}
                setUp={setUp}
                busy={state.phase === 'applying'}
                onChange={update}
                onKind={(k) => {
                  switchKind(current, k);
                }}
                onRemove={remove}
              />
              <div className="flex flex-col gap-4">
                {setUp && <ConnectedNow guests={guests?.[current.id]} on={currentNet.form.enabled} />}
                <WhatItGets form={current} access={currentNet.access} others={forms.filter((f) => f.id !== current.id)} />
              </div>
            </div>
          </>
        )}
      </div>
      <SaveArea
        visible={dirty}
        busy={state.phase === 'applying'}
        invalid={invalid}
        warnings={(() => {
          const lines = dirty ? saveWarnings(forms, saved.nets, data.radios) : [];
          return lines.length === 0 ? [] : [...lines, 'Your main network keeps running.'];
        })()}
        confirm={undefined}
        onSave={settings.save}
        onRevert={() => {
          settings.discard();
          setKinds({});
        }}
      />
      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a guest network</DialogTitle>
            <DialogDescription>
              A network of its own, with its own Wi-Fi name and addresses: its devices get the internet, but not your devices or
              those on your other guest networks. Each one shares its bands’ airtime and adds its own beacons (about 0.5% of the
              airtime per band), so there can be up to {String(GUEST_IDS.length)}.
            </DialogDescription>
          </DialogHeader>
          <KindChoice label="What it’s for" onPick={add} />
        </DialogContent>
      </Dialog>
      <Dialog
        open={confirmRemove !== undefined}
        onOpenChange={(open) => {
          if (!open) setConfirmRemove(undefined);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {confirmRemove === undefined ? 'this network' : labelOf(confirmRemove.form)}?</DialogTitle>
            <DialogDescription>
              Its access points, its interface and address, its DHCP pool, its firewall zone and rules and its speed limit all go,
              here and in LuCI. To only pause it, turn it off instead.{dirty ? ' Changes you haven’t saved are dropped too.' : ''}
            </DialogDescription>
          </DialogHeader>
          {confirmRemove !== undefined && Object.keys(confirmRemove.aps).length > 0 && (
            <Alert variant="warning">
              <TriangleAlertIcon />
              <AlertDescription>Its devices are disconnected; your main network keeps running.</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setConfirmRemove(undefined);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                const net = confirmRemove;
                setConfirmRemove(undefined);
                if (net !== undefined) void apply(removal(net));
              }}
            >
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
