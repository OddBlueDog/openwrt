// A band's radio, in the band's card under its network's fields: its Wi-Fi
// mode, width, channel and power, then the rarely changed (a hidden name, a
// random address, a forced cipher, beamforming), all shown; the card's foot
// points to the Wi-Fi driver page for the rest.
import { TriangleAlertIcon } from 'lucide-react';
import type { ReactElement } from 'react';
import { Field } from '@/components/field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import type { RegRule } from '@/lib/api/wireless';
import { href } from '@/lib/router';
import { blockOf, describeBlock } from './channels';
import { explain } from '@/components/explain';
import {
  channelLimit,
  cipherOption,
  cipherOptions,
  modesFor,
  noFaster,
  type RadioForm,
  type RadioOptions,
  standardsFor,
  usable,
  widthAllowed,
} from './model';
import { Note } from '@/components/note';

type Set = <K extends keyof RadioForm>(key: K, value: RadioForm[K]) => void;

export function RadioFields({
  form,
  options,
  rules,
  onChange: set,
}: {
  form: RadioForm;
  options: RadioOptions | undefined;
  /** The country's rules, for each channel's power limit. */
  rules: readonly RegRule[] | undefined;
  onChange: Set;
}): ReactElement {
  const id = (field: string): string => `${form.radio}-${field}`;
  const radio = `wireless.${form.radio}`;
  const iface = form.iface === undefined ? undefined : `wireless.${form.iface}`;
  const dfs = new Set(options?.dfs ?? []);
  const channels = (options?.channels ?? []).filter((c) => usable(c, rules) && (form.allowDfs || !dfs.has(c.mhz)));
  const hasCurrent = form.channel === 'auto' || channels.some((c) => String(c.channel) === form.channel);
  const available = modesFor(form.band, options?.htmodes);
  const standards = standardsFor(form.band, available);
  const standard = standards.find((s) => s.value === `${form.modePrefix}:${form.requireMode}`);
  // Widths the chosen channel may have in the country (on Auto: any channel
  // it may pick); the radio itself offers every width it can do.
  const widthsOn = (channel: string, widths: readonly string[]): string[] => {
    const all = options?.channels ?? [];
    if (rules === undefined || all.length === 0) return [...widths];
    const candidates = channel === 'auto' ? channels : all.filter((c) => String(c.channel) === channel);
    return widths.filter((w) => candidates.some((c) => widthAllowed(form.band, c.channel, Number(w), all, rules)));
  };
  // the 20 MHz channels the chosen channel and width take up (unknown on Auto)
  const width = form.modePrefix === 'NOHT' || form.width === '' ? 20 : Number(form.width);
  const block = form.channel === 'auto' ? undefined : blockOf(form.band, Number(form.channel), width);
  // 5 and 6 GHz blocks are fixed; 2.4 GHz pairs with the channel 4 above (1–6) or below (7–13)
  const fixedBlocks = form.band !== '2g';
  const widestOn = (channel: string, prefix: string): string =>
    widthsOn(channel, available.find((m) => m.prefix === prefix)?.widths ?? []).at(-1) ?? '';
  const modeWidths = widthsOn(form.channel, available.find((m) => m.prefix === form.modePrefix)?.widths ?? []);
  // The radio lists powers up to what the channel it's on now allows, which
  // needn't be the one chosen here; go by the chosen channel's rule (on Auto,
  // the most any channel it may pick allows: the radio holds to the one it picks).
  const limitFor = (channel: string): number | undefined => {
    if (rules === undefined) return undefined;
    const limits = channels
      .filter((c) => channel === 'auto' || String(c.channel) === channel)
      .flatMap((c) => channelLimit(rules, c.mhz) ?? []);
    return limits.length === 0 ? undefined : Math.max(...limits);
  };
  const limit = limitFor(form.channel);
  const powers = Array.from({ length: limit ?? Math.max(0, ...(options?.txpowers ?? [])) }, (_, i) => i + 1);
  const savedPower = form.txpower === '' ? undefined : Number(form.txpower);
  // none for Open or a mode set elsewhere: a cipher saved with one stays as it is
  const ciphers = cipherOptions.filter((c) => (c.modes as readonly string[]).includes(form.encryption));
  const cipher = form.cipher === '' ? undefined : cipherOption(form.cipher);
  const cipherHint =
    form.cipher === ''
      ? form.encryption === 'psk-mixed'
        ? 'OpenWrt’s choice: CCMP (AES), for WPA too. WPA-only devices with just TKIP can’t join on it.'
        : 'OpenWrt’s choice: CCMP (AES), which every WPA2 and WPA3 device has.'
      : cipher === undefined
        ? 'Set outside this page.'
        : cipher.value === 'ccmp'
          ? 'The same as Auto in this mode.'
          : `${cipher.label}, for broadcasts to every device too.`;
  const cipherWarning =
    cipher?.warning === undefined
      ? undefined
      : [
          cipher.warning,
          form.encryption === 'sae-mixed' ? 'WPA2/WPA3 mode is there for WPA2 devices, and most of them have only CCMP.' : '',
          cipher.value === 'tkip+ccmp' ? '' : noFaster,
        ]
          .filter((s) => s !== '')
          .join(' ');
  const beamformingShown = ['VHT', 'HE', 'EHT'].includes(form.modePrefix);
  const htmode = form.modePrefix === 'NOHT' ? 'NOHT' : `${form.modePrefix}${form.width}`;

  return (
    // two cells of the band card's grid: the radio's fields under the network's, and the card's foot
    <>
      <div className="divide-y border-t @min-[28rem]:col-start-1">
        <Field
          id={id('mode')}
          label="Wi-Fi mode"
          {...explain(
            `${standard?.hint ?? 'Set outside this page.'} The newest standard the radio runs, and the oldest a device needs to join. In OpenWrt’s terms: ${htmode}${form.requireMode === '' ? '' : `, require_mode ${form.requireMode}`}.`,
            [`${radio}.htmode`, `${radio}.require_mode`],
          )}
        >
          <Select
            value={`${form.modePrefix}:${form.requireMode}`}
            onValueChange={(v) => {
              const [prefix = '', requireMode = ''] = v.split(':');
              set('modePrefix', prefix);
              set('requireMode', requireMode);
              // keep the width if the new mode has it on this channel, otherwise the widest it has
              const widths = widthsOn(form.channel, available.find((m) => m.prefix === prefix)?.widths ?? []);
              if (!widths.includes(form.width)) set('width', widths.at(-1) ?? '');
            }}
          >
            <SelectTrigger id={id('mode')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {standards.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
              {standard === undefined && (
                <SelectItem value={`${form.modePrefix}:${form.requireMode}`}>
                  {form.modePrefix}
                  {form.requireMode === '' ? '' : `, require_mode ${form.requireMode}`} (set elsewhere)
                </SelectItem>
              )}
            </SelectContent>
          </Select>
        </Field>
        {form.modePrefix !== 'NOHT' && (
          <Field
            id={id('width')}
            label="Channel width"
            {...explain('Wider is faster; narrower reaches further and meets less interference.', [`${radio}.htmode`])}
            // an error, not an explanation: it shows in every theme
            error={
              modeWidths.includes(form.width)
                ? undefined
                : `${form.channel === 'auto' ? 'No channel' : `Channel ${form.channel}`} can’t be ${form.width} MHz wide in this country, so the network won’t start. Choose a narrower width or another channel.`
            }
          >
            <Select
              value={form.width}
              onValueChange={(v) => {
                set('width', v);
              }}
            >
              <SelectTrigger id={id('width')} aria-invalid={!modeWidths.includes(form.width)}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {modeWidths.map((w) => (
                  <SelectItem key={w} value={w}>
                    {w} MHz
                  </SelectItem>
                ))}
                {!modeWidths.includes(form.width) && <SelectItem value={form.width}>{form.width} MHz (not allowed)</SelectItem>}
              </SelectContent>
            </Select>
          </Field>
        )}
        <Field
          id={id('channel')}
          label="Channel"
          {...explain(
            block === undefined
              ? 'Auto picks the quietest one at start-up.'
              : block.length === 1
                ? `One 20 MHz channel${dfs.size > 0 ? '; DFS marks the ones that need a radar check first' : ''}.`
                : `At ${String(width)} MHz this takes up channels ${describeBlock(form.band, block)}${fixedBlocks ? ', whichever of them you pick' : ''}. Channel ${form.channel} is the primary: the network announces itself there, and devices that can’t use the whole width use the part it’s in.`,
            [`${radio}.channel`],
          )}
        >
          <Select
            value={form.channel}
            onValueChange={(v) => {
              set('channel', v);
              // a width the new channel can't have would stop the network starting
              if (form.modePrefix !== 'NOHT' && !widthsOn(v, [form.width]).includes(form.width))
                set('width', widestOn(v, form.modePrefix));
              // a power above the new channel's limit would only be cut back to it
              const next = limitFor(v);
              if (savedPower !== undefined && next !== undefined && savedPower > next) set('txpower', '');
            }}
          >
            <SelectTrigger id={id('channel')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Auto</SelectItem>
              {channels.map((c) => (
                <SelectItem key={c.mhz} value={String(c.channel)}>
                  {c.channel} ({(c.mhz / 1000).toFixed(3)} GHz){dfs.has(c.mhz) ? ' · DFS, radar check' : ''}
                </SelectItem>
              ))}
              {!hasCurrent && <SelectItem value={form.channel}>{form.channel}</SelectItem>}
            </SelectContent>
          </Select>
        </Field>
        {form.band === '5g' && (options?.dfs.length ?? 0) > 0 && (
          <Field
            id={id('dfs')}
            label="Use radar channels (DFS)"
            {...explain(
              'More channels, often quieter. On one, the router first listens for radar for a minute or more, and moves away if radar appears. Off, Auto keeps to the others and they leave the channel list.',
              [`${radio}.acs_exclude_dfs`],
            )}
          >
            <Switch
              id={id('dfs')}
              checked={form.allowDfs}
              onCheckedChange={(v) => {
                set('allowDfs', v);
                // a DFS channel picked by hand can't stay when they're not allowed
                const current = (options?.channels ?? []).find((c) => String(c.channel) === form.channel);
                if (!v && current !== undefined && dfs.has(current.mhz)) set('channel', 'auto');
              }}
            />
          </Field>
        )}
        <Field
          id={id('txpower')}
          label="Transmit power"
          {...explain(
            limit === undefined
              ? 'Maximum allowed is the most the country lets this channel send.'
              : form.channel === 'auto'
                ? `Up to ${String(limit)} dBm, depending on the channel Auto picks.`
                : `Up to ${String(limit)} dBm on channel ${form.channel}.`,
            [`${radio}.txpower`],
          )}
        >
          <Select
            value={form.txpower === '' ? 'max' : form.txpower}
            onValueChange={(v) => {
              set('txpower', v === 'max' ? '' : v);
            }}
          >
            <SelectTrigger id={id('txpower')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="max">Maximum allowed</SelectItem>
              {powers.map((d) => (
                <SelectItem key={d} value={String(d)}>
                  {d} dBm ({Math.round(10 ** (d / 10))} mW)
                </SelectItem>
              ))}
              {savedPower !== undefined && !powers.includes(savedPower) && (
                <SelectItem value={form.txpower}>
                  {form.txpower} dBm
                  {limit !== undefined && savedPower > limit ? ` (over the limit: ${String(limit)} dBm is used)` : ''}
                </SelectItem>
              )}
            </SelectContent>
          </Select>
        </Field>
        {iface !== undefined && (
          <>
            <Field
              id={id('hidden')}
              label="Hide the network name"
              {...explain('Devices must type the name to join.', [`${iface}.hidden`])}
            >
              <Switch
                id={id('hidden')}
                checked={form.hidden}
                onCheckedChange={(v) => {
                  set('hidden', v);
                }}
              />
            </Field>
            <Field
              id={id('random-bssid')}
              label="New address at each start"
              {...explain(
                'A new random hardware address (BSSID) each time Wi-Fi starts. It can’t then be used to recognise this router; devices still find the network by name.',
                [`${iface}.macaddr`],
              )}
            >
              <Switch
                id={id('random-bssid')}
                checked={form.randomBssid}
                onCheckedChange={(v) => {
                  set('randomBssid', v);
                }}
              />
            </Field>
          </>
        )}
        {iface !== undefined && ciphers.length > 0 && (
          <Field id={id('cipher')} label="Encryption cipher" {...explain(cipherHint, [`${iface}.encryption`])}>
            <Select
              value={form.cipher === '' ? 'auto' : form.cipher}
              onValueChange={(v) => {
                set('cipher', v === 'auto' ? '' : v);
              }}
            >
              <SelectTrigger id={id('cipher')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto (CCMP)</SelectItem>
                {ciphers.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
                {form.cipher !== '' && !ciphers.some((c) => c.value === form.cipher) && (
                  <SelectItem value={form.cipher}>{cipher?.label ?? form.cipher} (set elsewhere)</SelectItem>
                )}
              </SelectContent>
            </Select>
            {cipherWarning !== undefined && (
              <Note tone="warning" icon={<TriangleAlertIcon />}>
                {cipherWarning}
              </Note>
            )}
          </Field>
        )}
        {beamformingShown && (
          <>
            <Field
              id={id('beamforming')}
              label="Beamforming"
              {...explain(
                'Aims the signal at each device instead of spreading it evenly, for more speed and range. Devices need Wi-Fi 5 or newer to use it. What each band runs with now is on the Wi-Fi driver page.',
                [`${radio}.su_beamformer`, `${radio}.he_su_beamformer`],
              )}
            >
              <Switch
                id={id('beamforming')}
                checked={form.beamforming}
                onCheckedChange={(v) => {
                  set('beamforming', v);
                  // MU-MIMO is beamforming to several devices: it can't stay on without it
                  if (!v) set('muMimo', false);
                }}
              />
            </Field>
            <Field
              id={id('mumimo')}
              label="MU-MIMO"
              status={form.beamforming ? undefined : 'Needs beamforming.'}
              {...explain(
                'Beamforming to several devices at once. Some Wi-Fi cards handle it badly: turn it off if one keeps dropping out.',
                [`${radio}.mu_beamformer`, `${radio}.he_mu_beamformer`, `${radio}.mu_beamformee`],
              )}
            >
              <Switch
                id={id('mumimo')}
                checked={form.muMimo}
                disabled={!form.beamforming}
                onCheckedChange={(v) => {
                  set('muMimo', v);
                }}
              />
            </Field>
          </>
        )}
      </div>
      {/* the card's foot: where the rest of the radio's settings are */}
      <p className="col-span-full self-end border-t pt-4 text-sm text-muted-foreground">
        For further settings, see the{' '}
        <a href={href('wifi-driver')} className="font-medium link">
          Wi-Fi driver page
        </a>
        .
      </p>
    </>
  );
}
