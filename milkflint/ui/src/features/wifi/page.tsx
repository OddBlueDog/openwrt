// Networks & radios: the country first (it decides what every band may do),
// then one card per band with its network (on air now, name, password,
// security, QR code) and its radio together, and the radar log that explains
// a 5 GHz band waiting to start. The driver's knobs (airtime, wake times,
// spatial reuse…) are on the Wi-Fi driver page under Advanced, which each
// band's card links to.
import { WifiIcon, WifiOffIcon } from 'lucide-react';
import { useSuspenseQuery } from '@tanstack/react-query';
import { type ReactElement, useMemo } from 'react';
import { ApplyStatus } from '@/components/apply-status';
import { PageHeader } from '@/components/layout/page-header';
import { PageBoundary } from '@/components/page-boundary';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useApply } from '@/hooks/use-apply';
import { useFormValues, useSettingsForm } from '@/lib/form/use-settings-form';
import { useLive } from '@/lib/query/use-live';
import { cn } from '@/lib/utils';
import { BandCard } from './band-card';
import { CountryCard } from './country';
import { useWifiLive } from './live';
import {
  bandLabel,
  bandOrder,
  impactLines,
  networkChanged,
  networkChanges,
  networkImpacts,
  radarCheckSeconds,
  radarNote,
  networkErrors,
  type RadioForm,
  type WifiForm,
  wifiFormSchema,
} from './model';
import { wifiQueries } from './queries';
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

export function WifiPage(): ReactElement {
  return (
    <>
      <PageHeader title="Networks & radios" description="Your Wi-Fi network on each band: its name, password and radio." />
      <PageBoundary>
        <WifiSettings />
      </PageBoundary>
    </>
  );
}

function WifiSettings(): ReactElement {
  const { data } = useSuspenseQuery(wifiQueries.networks());
  const live = useWifiLive();
  const { state, apply } = useApply();

  // not set on every radio: the radios' own country (GB if none has one) is
  // filled in, so saving sets it everywhere (Discard leaves it as it is);
  // nothing when the radios have different ones
  const saved = useMemo(
    (): WifiForm => ({
      country: data.country === '' ? data.fill : data.country,
      radios: [...data.forms].sort((a, b) => bandOrder(a.band) - bandOrder(b.band)),
    }),
    [data],
  );
  const settings = useSettingsForm({
    schema: wifiFormSchema,
    saved,
    onSave: async (values) => {
      await save(values);
    },
  });
  const { form: formApi } = settings;
  const values = useFormValues(formApi);
  const forms = values.radios;
  const country = values.country;
  const countryDirty = country !== data.country;
  const rules = useLive(wifiQueries.regulatory(country)).data?.rules;
  const dirty = countryDirty || forms.some((f, i) => networkChanged(f, saved.radios[i]));
  const invalid = forms.some((f) => Object.keys(networkErrors(f)).length > 0);

  // what the save does to devices, said beside Save before it's pressed
  const impacts = networkImpacts(forms, saved.radios, countryDirty, data.options);
  const allOff = forms.length > 0 && forms.every((f) => !f.enabled) && saved.radios.some((f) => f.enabled);
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

  const save = async ({ radios, country }: WifiForm): Promise<void> => {
    const countryChanged = country !== data.country;
    const changes = radios.flatMap((f, i) => {
      const before = saved.radios[i];
      return before === undefined || !networkChanged(f, before) ? [] : networkChanges(f, before);
    });
    if (countryChanged && country !== '') {
      for (const radio of data.radios) changes.push({ op: 'set', config: 'wireless', section: radio, values: { country } });
    }
    // A radio that restarts on radar channels stays off for its radar check:
    // say so, as devices on it are gone for that long.
    const radarS = Math.max(
      0,
      ...radios.map((f, i) =>
        countryChanged || networkChanged(f, saved.radios[i]) ? radarCheckSeconds(f, data.options[f.radio]) : 0,
      ),
    );
    const note = radarNote(radarS);
    await apply(changes, note === undefined ? undefined : { note });
  };

  const set =
    (i: number) =>
    <K extends keyof RadioForm>(key: K, value: RadioForm[K]): void => {
      formApi.setFieldValue(`radios[${i}]`, (f) => ({ ...f, [key]: value }));
    };
  // side by side once each card has room for its live readings and the QR code beside the fields
  const cols = forms.length >= 3 ? 'xl:grid-cols-2 2xl:grid-cols-3' : 'xl:grid-cols-2';

  return (
    <>
      <div className="flex flex-col gap-4">
        {data.forms.length > 0 && data.forms.every((f) => !f.enabled) && (
          <WifiOffNotice
            forms={forms}
            onTurnOn={() => {
              formApi.setFieldValue(
                'radios',
                forms.map((f) => ({ ...f, enabled: true, encryption: f.encryption === 'none' ? 'sae-mixed' : f.encryption })),
              );
            }}
          />
        )}
        <ApplyStatus state={state} />
        <>
          {/* the country first: it decides what every band below may do */}
          <CountryCard
            countries={data.countries}
            value={country}
            saved={data.country}
            mixed={data.mixed}
            radios={data.radios}
            bandsHere={[...new Set(forms.map((f) => f.band))]}
            onChange={(c) => {
              formApi.setFieldValue('country', c);
            }}
          />
          {/* one card per band: its network, then its radio; side by side, rows lining up */}
          <div className={cn('grid gap-4', cols)}>
            {forms.map((f, i) => (
              <BandCard
                key={f.radio}
                form={f}
                saved={saved.radios[i] ?? f}
                live={live?.find((b) => b.radio === f.radio)}
                options={data.options[f.radio]}
                rules={rules}
                onChange={set(i)}
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
      </div>
      <SaveArea
        visible={dirty}
        busy={state.phase === 'applying'}
        invalid={invalid}
        warnings={warnings}
        confirm={confirm}
        onSave={settings.save}
        onRevert={() => {
          settings.discard();
          // Discard leaves the country as the radios have it (none filled in)
          formApi.setFieldValue('country', data.country);
        }}
      />
    </>
  );
}
