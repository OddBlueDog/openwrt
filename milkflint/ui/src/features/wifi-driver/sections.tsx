// The Wi-Fi driver page's cards: each of the driver's settings for every band,
// side by side, with what it's doing now where the router can tell.
import type { ReactElement } from 'react';
import { CardHeading } from '@/components/card-heading';
import { Field } from '@/components/field';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { AirtimeBandsTable } from '../wifi/airtime-bands';
import { AirtimeLive } from '../wifi/airtime-card';
import { explain } from '@/components/explain';
import {
  HOLD_BACK_LABELS,
  HOLD_BACK_OPTIONS,
  HOLD_BACK_WHAT,
  type HoldBack,
  holdBackChoiceHint,
  holdBackChoices,
} from '../wifi/hold-back';
import { type RadioForm, type RadioOptions, validateDriver } from '../wifi/model';
import { qosMapChoice, qosMapHint, qosMapValue } from '../wifi/qos-map';
import {
  SPR_MODE_LABELS,
  SPR_THRESHOLDS,
  type SprMode,
  sprHint,
  sprModes,
  sprNow,
  sprOption,
  sprThresholdLabel,
} from '../wifi/spatial-reuse';
import {
  TWT_FLOWS,
  TWT_MIN_WAKES,
  TWT_PRESET_LABELS,
  TWT_PRESETS,
  TWT_STA_FLOWS,
  TWT_TRIGGER_LABELS,
  type TwtPreset,
  type TwtTrigger,
  twtChoices,
  twtIntervalLabel,
  twtMaxChoices,
  twtMinChoices,
  twtOption,
  twtPresetHint,
  twtTriggerHint,
  twtWakeLabel,
  twtWithPreset,
} from '../wifi/twt';
import { TwtLive } from '../wifi/twt-card';
import { BandColumns, NeedsWifi6, NoNetwork, NowSection } from './band-columns';

type Set = (f: RadioForm) => <K extends keyof RadioForm>(key: K, value: RadioForm[K]) => void;

interface SectionProps {
  forms: readonly RadioForm[];
  options: Readonly<Record<string, RadioOptions>>;
  set: Set;
}

const id = (f: RadioForm, field: string): string => `${f.radio}-${field}`;
const wifi6 = (f: RadioForm): boolean => ['HE', 'EHT'].includes(f.modePrefix);

/** A select of numbers or words, the setting's choices as labelled */
function Choice<T extends string | number>({
  id: controlId,
  value,
  choices,
  label,
  onChange,
}: {
  id: string;
  value: T;
  choices: readonly T[];
  label: (v: T) => string;
  onChange: (v: string) => void;
}): ReactElement {
  return (
    <Select value={String(value)} onValueChange={onChange}>
      <SelectTrigger id={controlId}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {choices.map((c) => (
          <SelectItem key={c} value={String(c)}>
            {label(c)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function AirtimeSection({ forms, set }: Omit<SectionProps, 'options'>): ReactElement {
  return (
    <Card>
      <CardHeading
        title="Airtime fairness"
        description="Where it’s on, a device with a poor link gets a smaller share of the air while others want it. Below the settings: who is using the air, second by second."
      />
      <CardContent className="flex flex-col gap-4">
        <BandColumns topic="airtime" forms={forms}>
          {(f) => (
            <>
              <Field
                id={id(f, 'airtime')}
                label="Smaller share for poor links"
                {...explain(
                  'Applies within a second, without restarting Wi-Fi. Devices with a poor link get a smaller share of the air, and the slowest are held back while a device with a good link is waiting. Off, every busy device gets an equal share, however slow its link.',
                  [`milkflint.wifi.airtime_${f.band}`, `milkflint.wifi.airtime_${f.band}_*`],
                )}
              >
                <Switch
                  id={id(f, 'airtime')}
                  checked={f.airtime}
                  onCheckedChange={(v) => {
                    set(f)('airtime', v);
                  }}
                />
              </Field>
              {f.airtime && (
                <AirtimeBandsTable
                  idPrefix={id(f, 'airtime')}
                  band={f.band}
                  value={f.airtimeBands}
                  errors={validateDriver(f)}
                  onChange={(v) => {
                    set(f)('airtimeBands', v);
                  }}
                />
              )}
            </>
          )}
        </BandColumns>
        <NowSection id="airtime-now" title="Who is using the air now">
          <AirtimeLive />
        </NowSection>
      </CardContent>
    </Card>
  );
}

export function TwtSection({ forms, options, set }: SectionProps): ReactElement {
  return (
    <Card>
      <CardHeading
        title="Target Wake Time"
        description="A Wi-Fi 6 device can agree a schedule with the router and sleep between wake times, saving battery. Few devices ask yet, and most only when their battery matters."
      />
      <CardContent className="flex flex-col gap-4">
        <BandColumns topic="twt" forms={forms}>
          {(f) => {
            if (!wifi6(f)) return <NeedsWifi6 />;
            const limits = options[f.radio]?.twtLimits === true;
            const driver = (name: string): string => `milkflint.wifi.${twtOption(f.band, name)}`;
            const setTwt = (twt: RadioForm['twt']): void => {
              set(f)('twt', twt);
            };
            return (
              <>
                <Field
                  id={id(f, 'twt')}
                  label="Offer wake schedules"
                  {...explain(
                    'Wi-Fi 6 devices that ask can agree a schedule and sleep between wake times. The device asks and chooses; the settings below say what the router agrees to. Turning it off or on restarts this band’s network.',
                    [`wireless.${f.radio}.he_twt_responder`],
                  )}
                >
                  <Switch
                    id={id(f, 'twt')}
                    checked={f.twt.on}
                    onCheckedChange={(v) => {
                      setTwt({ ...f.twt, on: v });
                    }}
                  />
                </Field>
                {f.twt.on && limits && (
                  <Field
                    id={id(f, 'twtPreset')}
                    label="Sleep schedules"
                    {...explain(`${twtPresetHint(f.twt.preset)} The limits go to the driver at once, for new requests.`, [
                      driver('*'),
                    ])}
                  >
                    <Choice
                      id={id(f, 'twtPreset')}
                      value={f.twt.preset}
                      choices={[...(Object.keys(TWT_PRESETS) as TwtPreset[]), 'custom' as const]}
                      label={(p) => TWT_PRESET_LABELS[p]}
                      onChange={(v) => {
                        setTwt(twtWithPreset(f.twt, v as TwtPreset | 'custom'));
                      }}
                    />
                  </Field>
                )}
                {f.twt.on && limits && f.twt.preset === 'custom' && (
                  <>
                    <Field
                      id={id(f, 'twtMax')}
                      label="Longest sleep"
                      {...explain(
                        'A device asking for longer is offered this. Anything sent to a device waits up to this long, and one that sleeps for minutes can be dropped for not answering.',
                        [driver('max_interval')],
                      )}
                    >
                      <Choice
                        id={id(f, 'twtMax')}
                        value={f.twt.maxIntervalMs}
                        choices={twtMaxChoices(f.twt)}
                        label={twtIntervalLabel}
                        onChange={(v) => {
                          setTwt({ ...f.twt, maxIntervalMs: Number(v) });
                        }}
                      />
                    </Field>
                    <Field
                      id={id(f, 'twtMin')}
                      label="Shortest sleep"
                      {...explain('A device asking for less is offered this. Keeps very frequent wake-ups off the air.', [
                        driver('min_interval'),
                      ])}
                    >
                      <Choice
                        id={id(f, 'twtMin')}
                        value={f.twt.minIntervalMs}
                        choices={twtMinChoices(f.twt)}
                        label={twtIntervalLabel}
                        onChange={(v) => {
                          setTwt({ ...f.twt, minIntervalMs: Number(v) });
                        }}
                      />
                    </Field>
                    <Field
                      id={id(f, 'twtWake')}
                      label="Least time awake"
                      {...explain(
                        'How long a device has to stay awake at each wake time. The radio can’t do less than the shortest here.',
                        [driver('min_wake')],
                      )}
                    >
                      <Choice
                        id={id(f, 'twtWake')}
                        value={f.twt.minWake}
                        choices={twtChoices(TWT_MIN_WAKES, f.twt.minWake)}
                        label={twtWakeLabel}
                        onChange={(v) => {
                          setTwt({ ...f.twt, minWake: Number(v) });
                        }}
                      />
                    </Field>
                    <Field
                      id={id(f, 'twtFlows')}
                      label="Schedules on this band"
                      {...explain('More than this are turned down.', [driver('flows')])}
                    >
                      <Choice
                        id={id(f, 'twtFlows')}
                        value={f.twt.flows}
                        choices={twtChoices(TWT_FLOWS, f.twt.flows)}
                        label={String}
                        onChange={(v) => {
                          setTwt({ ...f.twt, flows: Number(v) });
                        }}
                      />
                    </Field>
                    <Field
                      id={id(f, 'twtStaFlows')}
                      label="Schedules per device"
                      {...explain('More than this are turned down.', [driver('sta_flows')])}
                    >
                      <Choice
                        id={id(f, 'twtStaFlows')}
                        value={f.twt.staFlows}
                        choices={twtChoices(TWT_STA_FLOWS, f.twt.staFlows)}
                        label={String}
                        onChange={(v) => {
                          setTwt({ ...f.twt, staFlows: Number(v) });
                        }}
                      />
                    </Field>
                    <Field
                      id={id(f, 'twtTrigger')}
                      label="Trigger-enabled schedules"
                      {...explain(twtTriggerHint(f.twt.trigger), [driver('trigger')])}
                    >
                      <Choice
                        id={id(f, 'twtTrigger')}
                        value={f.twt.trigger}
                        choices={Object.keys(TWT_TRIGGER_LABELS) as TwtTrigger[]}
                        label={(t) => TWT_TRIGGER_LABELS[t]}
                        onChange={(v) => {
                          setTwt({ ...f.twt, trigger: v as TwtTrigger });
                        }}
                      />
                    </Field>
                  </>
                )}
              </>
            );
          }}
        </BandColumns>
        <NowSection id="twt-now" title="Wake schedules now">
          <TwtLive />
        </NowSection>
      </CardContent>
    </Card>
  );
}

const SPR_WHAT =
  'Sends while a neighbouring network is heard only weakly, instead of waiting for it. It can add speed in a crowded area, and cost retries if a device can’t hear past the neighbour.';

export function SharingSection({ forms, options, set }: SectionProps): ReactElement {
  return (
    <Card>
      <CardHeading
        title="Sharing the channel"
        description="When a band’s radio and its Wi-Fi 6 devices may send on a busy channel: past a weak neighbour, and after a turn the router scheduled."
      />
      <CardContent>
        <BandColumns topic="sharing" forms={forms}>
          {(f) => {
            if (!wifi6(f)) return <NeedsWifi6 />;
            const now = options[f.radio]?.spr;
            const modes = sprModes((now?.mode ?? null) !== null);
            const radio = `wireless.${f.radio}`;
            return (
              <>
                <Field
                  id={id(f, 'spr')}
                  label="Spatial reuse"
                  {...explain(`${sprHint(f.spr.mode)} ${SPR_WHAT}`, [
                    `${radio}.he_spr_sr_control`,
                    `${radio}.he_spr_non_srg_obss_pd_max_offset`,
                    `milkflint.wifi.${sprOption(f.band)}`,
                  ])}
                >
                  <Select
                    value={f.spr.mode}
                    onValueChange={(v) => {
                      set(f)('spr', { ...f.spr, mode: v as SprMode });
                    }}
                  >
                    <SelectTrigger id={id(f, 'spr')}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {modes.map((m) => (
                        <SelectItem key={m} value={m}>
                          {SPR_MODE_LABELS[m]}
                        </SelectItem>
                      ))}
                      {!modes.includes(f.spr.mode as SprMode) && (
                        <SelectItem value={f.spr.mode}>
                          {f.spr.mode === 'custom'
                            ? 'Custom (set elsewhere)'
                            : `${SPR_MODE_LABELS[f.spr.mode]} (this driver can’t)`}
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                  {sprNow(now) !== '' && <p className="text-xs text-muted-foreground">{sprNow(now)}</p>}
                </Field>
                {(f.spr.mode === 'devices' || f.spr.mode === 'fixed') && (
                  <Field
                    id={id(f, 'sprThreshold')}
                    label="Ignore neighbours weaker than"
                    {...explain(
                      'A neighbour heard below this doesn’t hold back sending. Higher reuses more of the air, with more risk of retries.',
                      [`${radio}.he_spr_non_srg_obss_pd_max_offset`],
                    )}
                  >
                    <Choice
                      id={id(f, 'sprThreshold')}
                      value={f.spr.threshold}
                      choices={[
                        ...SPR_THRESHOLDS,
                        ...((SPR_THRESHOLDS as readonly number[]).includes(f.spr.threshold) ? [] : [f.spr.threshold]),
                      ]}
                      label={sprThresholdLabel}
                      onChange={(v) => {
                        set(f)('spr', { ...f.spr, threshold: Number(v) });
                      }}
                    />
                  </Field>
                )}
                <Field
                  id={id(f, 'holdBack')}
                  label="Hold-back after a scheduled turn"
                  {...explain(
                    `${holdBackChoiceHint(f.holdBack)} ${HOLD_BACK_WHAT} It is the MU EDCA timer the router announces, one per kind of traffic. Changing it restarts this band’s network.`,
                    HOLD_BACK_OPTIONS.map((o) => `${radio}.${o}`),
                  )}
                >
                  <Choice
                    id={id(f, 'holdBack')}
                    value={f.holdBack}
                    choices={holdBackChoices(f.holdBack)}
                    label={(h) => HOLD_BACK_LABELS[h]}
                    onChange={(v) => {
                      set(f)('holdBack', v as HoldBack);
                    }}
                  />
                </Field>
              </>
            );
          }}
        </BandColumns>
      </CardContent>
    </Card>
  );
}

export function GroupSection({ forms, set }: Omit<SectionProps, 'options'>): ReactElement {
  return (
    <Card>
      <CardHeading
        title="Group traffic and priorities"
        description="How multicast reaches devices, and what each DSCP mark gets on Wi-Fi."
      />
      <CardContent>
        <BandColumns topic="group" forms={forms}>
          {(f) => {
            if (f.iface === undefined) return <NoNetwork />;
            const iface = `wireless.${f.iface}`;
            const choice = qosMapChoice(f.qosMap);
            return (
              <>
                <Field
                  id={id(f, 'multicast')}
                  label="Send multicast to each device"
                  {...explain(
                    'On: each device gets its own copy of group traffic (multicast), sent at that device’s speed. Off: one copy for all devices, sent at the slowest speed. On saves a lot of airtime for multicast video, such as IPTV. For the small announcements most homes have, on costs a little more airtime and wakes sleeping devices more often.',
                    [`${iface}.multicast_to_unicast`],
                  )}
                >
                  <Switch
                    id={id(f, 'multicast')}
                    checked={f.multicastToUnicast}
                    onCheckedChange={(v) => {
                      set(f)('multicastToUnicast', v);
                    }}
                  />
                </Field>
                <Field
                  id={id(f, 'qosMap')}
                  label="Priority of marked traffic"
                  {...explain(qosMapHint(choice), [`${iface}.qos_map_set`])}
                >
                  <Select
                    value={choice}
                    onValueChange={(v) => {
                      set(f)('qosMap', v === 'custom' ? f.qosMap : (qosMapValue(v as 'edge' | 'openwrt') ?? ''));
                    }}
                  >
                    <SelectTrigger id={id(f, 'qosMap')}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="edge">For a home network (RFC 8325)</SelectItem>
                      <SelectItem value="openwrt">OpenWrt’s own</SelectItem>
                      {choice === 'custom' && <SelectItem value="custom">Custom (set elsewhere)</SelectItem>}
                    </SelectContent>
                  </Select>
                </Field>
              </>
            );
          }}
        </BandColumns>
      </CardContent>
    </Card>
  );
}
