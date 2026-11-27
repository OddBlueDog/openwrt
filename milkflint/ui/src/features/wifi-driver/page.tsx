// The Wi-Fi driver: how each band's radio shares the air, for those who want
// the mechanism. Airtime fairness, Target Wake Time, spatial reuse, the
// hold-back after a scheduled turn (MU EDCA), multicast to each device, what
// each DSCP mark gets on Wi-Fi, and the beamforming the bands run with. The
// everyday settings (names, passwords, channels) are on Networks & radios;
// this page writes only its own options, so a save here never rewrites those.
import { pageLink } from '@/lib/router';
import { Link } from '@tanstack/react-router';
import { useSuspenseQuery } from '@tanstack/react-query';
import { type ReactElement, useMemo } from 'react';
import { ApplyStatus } from '@/components/apply-status';
import { PageHeader } from '@/components/layout/page-header';
import { PageBoundary } from '@/components/page-boundary';
import { useApply } from '@/hooks/use-apply';
import { sectionChanges } from '@/lib/api/uci';
import { useFormValues, useSettingsForm } from '@/lib/form/use-settings-form';
import { BeamformingCard } from '../wifi/beamforming';
import {
  bandOrder,
  driverChanged,
  driverChanges,
  driverImpacts,
  driverSection,
  impactLines,
  radarCheckSeconds,
  radarNote,
  type RadioForm,
} from '../wifi/model';
import { SaveArea } from '@/components/save-area';
import { driverFormSchema } from './model';
import { driverQueries } from './queries';
import { AirtimeSection, GroupSection, MuruSection, SharingSection, TwtSection } from './sections';

export function WifiDriverPage(): ReactElement {
  return (
    <>
      <PageHeader
        title="Wi-Fi driver"
        description="How each band’s radio shares the air between devices."
        status={
          <>
            Network names, passwords and channels are on{' '}
            <Link {...pageLink('wifi')} className="font-medium link">
              Networks &amp; radios
            </Link>
            .
          </>
        }
      />
      <PageBoundary>
        <WifiDriver />
      </PageBoundary>
    </>
  );
}

function WifiDriver(): ReactElement {
  const { data } = useSuspenseQuery(driverQueries.settings());
  const saved = useMemo(() => [...data.forms].sort((a, b) => bandOrder(a.band) - bandOrder(b.band)), [data]);
  const savedForm = useMemo(() => ({ radios: saved }), [saved]);
  const { state, apply } = useApply();
  const settings = useSettingsForm({
    schema: driverFormSchema,
    saved: savedForm,
    onSave: ({ radios: forms }) => {
      const changes = forms.flatMap((f, i) => {
        const before = saved[i];
        return before === undefined || !driverChanged(f, before) ? [] : driverChanges(f, before);
      });
      changes.push(...sectionChanges('milkflint', data.milkflint, 'wifi', driverSection(forms)));
      // a radio its save restarts on radar channels stays off for its radar check
      const radarS = Math.max(
        0,
        ...forms.map((f, i) => {
          const before = saved[i];
          return before !== undefined && driverChanges(f, before).length > 0 ? radarCheckSeconds(f, data.options[f.radio]) : 0;
        }),
      );
      const note = radarNote(radarS);
      return apply(changes, note === undefined ? undefined : { note });
    },
  });
  const { form } = settings;
  const forms = useFormValues(form).radios;
  const warnings = impactLines(driverImpacts(forms, saved, data.options));

  const set =
    (f: RadioForm) =>
    <K extends keyof RadioForm>(key: K, value: RadioForm[K]): void => {
      form.setFieldValue('radios', (radios) => radios.map((r) => (r.radio === f.radio ? { ...r, [key]: value } : r)));
    };

  return (
    <>
      <div className="flex flex-col gap-4">
        <ApplyStatus state={state} />
        <AirtimeSection forms={forms} saved={saved} set={set} />
        <TwtSection forms={forms} options={data.options} set={set} />
        <SharingSection forms={forms} options={data.options} set={set} />
        <MuruSection forms={forms} options={data.options} set={set} />
        <GroupSection forms={forms} set={set} />
        <BeamformingCard />
      </div>
      <SaveArea
        visible={settings.dirty}
        busy={state.phase === 'applying'}
        invalid={settings.invalid}
        warnings={warnings}
        confirm={undefined}
        onSave={settings.save}
        onRevert={settings.discard}
      />
    </>
  );
}
