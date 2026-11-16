// The Wi-Fi driver: how each band's radio shares the air, for those who want
// the mechanism. Airtime fairness, Target Wake Time, spatial reuse, the
// hold-back after a scheduled turn (MU EDCA), multicast to each device, what
// each DSCP mark gets on Wi-Fi, and the beamforming the bands run with. The
// everyday settings (names, passwords, channels) are on Networks & radios;
// this page writes only its own options, so a save here never rewrites those.
import { type ReactElement, useCallback, useMemo, useState } from 'react';
import { ApplyStatus } from '@/components/apply-status';
import { PageHeader } from '@/components/layout/page-header';
import { FormSkeleton, LoadError } from '@/components/page-states';
import { useApply } from '@/hooks/use-apply';
import { useLoad } from '@/hooks/use-load';
import { sectionChanges } from '@/lib/api/uci';
import { href } from '@/lib/router';
import { BeamformingCard } from '../wifi/beamforming';
import { loadWifi } from '../wifi/load';
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
  validateDriver,
} from '../wifi/model';
import { SaveArea } from '@/components/save-area';
import { AirtimeSection, GroupSection, SharingSection, TwtSection } from './sections';

const loadDriver = (): ReturnType<typeof loadWifi> => loadWifi('driver');

export function WifiDriverPage(): ReactElement {
  const { data, error, loading, reload } = useLoad(loadDriver);
  const [edits, setEdits] = useState<Record<string, RadioForm>>({});
  const onApplied = useCallback(() => {
    setEdits({});
    reload();
  }, [reload]);
  const { state, apply } = useApply(onApplied);

  const saved = useMemo(() => [...(data?.forms ?? [])].sort((a, b) => bandOrder(a.band) - bandOrder(b.band)), [data]);
  const forms = useMemo(() => saved.map((f) => edits[f.radio] ?? f), [saved, edits]);
  const dirty = forms.some((f, i) => driverChanged(f, saved[i]));
  const invalid = forms.some((f) => Object.keys(validateDriver(f)).length > 0);
  const warnings = data === undefined ? [] : impactLines(driverImpacts(forms, saved, data.options));

  const save = (): void => {
    if (data === undefined) return;
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
    void apply(changes, note === undefined ? undefined : { note });
  };

  const set =
    (f: RadioForm) =>
    <K extends keyof RadioForm>(key: K, value: RadioForm[K]): void => {
      setEdits((e) => ({ ...e, [f.radio]: { ...(e[f.radio] ?? f), [key]: value } }));
    };

  return (
    <>
      <PageHeader
        title="Wi-Fi driver"
        description="How each band’s radio shares the air between devices."
        status={
          <>
            Network names, passwords and channels are on{' '}
            <a href={href('wifi')} className="font-medium link">
              Networks &amp; radios
            </a>
            .
          </>
        }
      />
      <div className="flex flex-col gap-4">
        <ApplyStatus state={state} />
        {error !== undefined && data === undefined ? (
          <LoadError error={error} retry={reload} />
        ) : loading && data === undefined ? (
          <FormSkeleton />
        ) : (
          <>
            <AirtimeSection forms={forms} set={set} />
            <TwtSection forms={forms} options={data?.options ?? {}} set={set} />
            <SharingSection forms={forms} options={data?.options ?? {}} set={set} />
            <GroupSection forms={forms} set={set} />
            <BeamformingCard />
          </>
        )}
      </div>
      <SaveArea
        visible={dirty}
        busy={state.phase === 'applying'}
        invalid={invalid}
        warnings={warnings}
        confirm={undefined}
        onSave={save}
        onRevert={() => {
          setEdits({});
        }}
      />
    </>
  );
}
