// Networks & radios: the country first (it decides what every band may do),
// then one card per band with its network (on air now, name, password,
// security, QR code) and its radio together, and the radar log that explains
// a 5 GHz band waiting to start. The driver's knobs (airtime, wake times,
// spatial reuse…) are on the Wi-Fi driver page under Advanced, which each
// band's card links to.
import { WifiIcon, WifiOffIcon } from 'lucide-react';
import { type ReactElement, useCallback, useMemo, useState } from 'react';
import { ApplyStatus } from '@/components/apply-status';
import { PageHeader } from '@/components/layout/page-header';
import { FormSkeleton, LoadError } from '@/components/page-states';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useApply } from '@/hooks/use-apply';
import { useLoad } from '@/hooks/use-load';
import { usePoll } from '@/hooks/use-poll';
import { getRegulatory } from '@/lib/api/wireless';
import { cn } from '@/lib/utils';
import { BandCard } from './band-card';
import { CountryCard } from './country';
import { useWifiLive } from './live';
import { loadWifi } from './load';
import {
  bandLabel,
  bandOrder,
  impactLines,
  networkChanged,
  networkChanges,
  networkImpacts,
  radarCheckSeconds,
  radarNote,
  type RadioForm,
  validateNetwork,
} from './model';
import { RadarCard } from './radar';
import { SaveArea, type SaveConfirm } from '@/components/save-area';

const RADAR_CARD = 'wifi-radar';

/**
 * Every band is off (a fresh install starts so): say how to turn Wi-Fi on.
 * The button turns every band on here, with WPA2/WPA3 for one left open, so
 * saving asks for a password first.
 */
function WifiOffNotice({ forms, onTurnOn }: { forms: readonly RadioForm[]; onTurnOn: () => void }): ReactElement {
  const turningOn = forms.every((f) => f.enabled);
  return (
    <Alert variant="info">
      <WifiOffIcon />
      <AlertTitle>{turningOn ? 'Wi-Fi turns on when you save' : 'Wi-Fi is off'}</AlertTitle>
      <AlertDescription className="gap-3">
        {turningOn ? (
          <p>Every band is on below: check each one’s network name and password, then save.</p>
        ) : (
          <>
            <p>Your Wi-Fi network is off on every band. Turn it on, give it a name and a password, and save.</p>
            <Button size="sm" onClick={onTurnOn}>
              <WifiIcon />
              Turn on Wi-Fi
            </Button>
          </>
        )}
      </AlertDescription>
    </Alert>
  );
}

const loadNetworks = (): ReturnType<typeof loadWifi> => loadWifi('networks');

export function WifiPage(): ReactElement {
  const { data, error, loading, reload } = useLoad(loadNetworks);
  const live = useWifiLive();
  const [edits, setEdits] = useState<Record<string, RadioForm>>({});
  // not set yet: GB is filled in, so saving sets it (Discard leaves it unset)
  const [countryEdit, setCountryEdit] = useState<string>();
  const onApplied = useCallback(() => {
    setEdits({});
    setCountryEdit(undefined);
    reload();
  }, [reload]);
  const { state, apply } = useApply(onApplied);

  const saved = useMemo(() => [...(data?.forms ?? [])].sort((a, b) => bandOrder(a.band) - bandOrder(b.band)), [data]);
  const forms = useMemo(() => saved.map((f) => edits[f.radio] ?? f), [saved, edits]);
  const country = countryEdit ?? (data === undefined ? '' : data.country === '' ? 'GB' : data.country);
  const countryDirty = data !== undefined && country !== data.country;
  const rules = usePoll(() => getRegulatory(country), 3_600_000, country).data?.rules;
  const dirty = countryDirty || forms.some((f, i) => networkChanged(f, saved[i]));
  const invalid = forms.some((f) => Object.keys(validateNetwork(f)).length > 0);

  // what the save does to devices, said beside Save before it's pressed
  const impacts = data === undefined ? [] : networkImpacts(forms, saved, countryDirty, data.options);
  const allOff = forms.length > 0 && forms.every((f) => !f.enabled) && saved.some((f) => f.enabled);
  const warnings = impactLines(impacts, allOff);
  const turningOff = impacts.filter((im) => im.kind === 'off').map((im) => bandLabel(im.band));
  const confirm: SaveConfirm | undefined =
    turningOff.length === 0
      ? undefined
      : allOff
        ? {
            title: 'Turn off Wi-Fi?',
            description:
              'Every band turns off when you save. Devices on Wi-Fi lose their connection, this one too if it’s on Wi-Fi: then only a cable reaches the router.',
            action: 'Turn off Wi-Fi',
          }
        : {
            title: `Turn off ${turningOff.join(' and ')}?`,
            description: `Devices on ${turningOff.join(' and ')} lose Wi-Fi when you save, this one too if it’s connected there: then it reaches the router over another band or a cable.`,
            action: `Turn off ${turningOff.join(' and ')}`,
          };

  const save = (): void => {
    if (data === undefined) return;
    const changes = forms.flatMap((f, i) => {
      const before = saved[i];
      return before === undefined || !networkChanged(f, before) ? [] : networkChanges(f, before);
    });
    if (countryDirty && country !== '') {
      for (const radio of data.radios) changes.push({ op: 'set', config: 'wireless', section: radio, values: { country } });
    }
    // A radio that restarts on radar channels stays off for its radar check:
    // say so, as devices on it are gone for that long.
    const radarS = Math.max(
      0,
      ...forms.map((f, i) => (countryDirty || networkChanged(f, saved[i]) ? radarCheckSeconds(f, data.options[f.radio]) : 0)),
    );
    const note = radarNote(radarS);
    void apply(changes, note === undefined ? undefined : { note });
  };

  const set =
    (f: RadioForm) =>
    <K extends keyof RadioForm>(key: K, value: RadioForm[K]): void => {
      setEdits((e) => ({ ...e, [f.radio]: { ...(e[f.radio] ?? f), [key]: value } }));
    };
  // side by side once each card has room for its live readings and the QR code beside the fields
  const cols = forms.length >= 3 ? 'xl:grid-cols-2 2xl:grid-cols-3' : 'xl:grid-cols-2';

  return (
    <>
      <PageHeader title="Networks & radios" description="Your Wi-Fi network on each band: its name, password and radio." />
      <div className="flex flex-col gap-4">
        {data !== undefined && data.forms.length > 0 && data.forms.every((f) => !f.enabled) && (
          <WifiOffNotice
            forms={forms}
            onTurnOn={() => {
              setEdits(
                Object.fromEntries(
                  forms.map((f) => [
                    f.radio,
                    { ...f, enabled: true, encryption: f.encryption === 'none' ? 'sae-mixed' : f.encryption },
                  ]),
                ),
              );
            }}
          />
        )}
        <ApplyStatus state={state} />
        {error !== undefined && data === undefined ? (
          <LoadError error={error} retry={reload} />
        ) : loading && data === undefined ? (
          <FormSkeleton />
        ) : (
          <>
            {/* the country first: it decides what every band below may do */}
            <CountryCard
              countries={data?.countries ?? []}
              value={country}
              saved={data?.country ?? ''}
              radios={data?.radios ?? []}
              bandsHere={[...new Set(forms.map((f) => f.band))]}
              onChange={setCountryEdit}
            />
            {/* one card per band: its network, then its radio; side by side, rows lining up */}
            <div className={cn('grid gap-4', cols)}>
              {forms.map((f, i) => (
                <BandCard
                  key={f.radio}
                  form={f}
                  saved={saved[i] ?? f}
                  live={live?.find((b) => b.radio === f.radio)}
                  options={data?.options[f.radio]}
                  rules={rules}
                  onChange={set(f)}
                  onShowRadar={
                    f.band === '5g'
                      ? () => {
                          document.getElementById(RADAR_CARD)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        }
                      : undefined
                  }
                />
              ))}
            </div>
            <RadarCard id={RADAR_CARD} />
          </>
        )}
      </div>
      <SaveArea
        visible={dirty}
        busy={state.phase === 'applying'}
        invalid={invalid}
        warnings={warnings}
        confirm={confirm}
        onSave={save}
        onRevert={() => {
          setEdits({});
          setCountryEdit(data?.country);
        }}
      />
    </>
  );
}
