// Multi-user (MU-MIMO & OFDMA) card: a single master switch per band, with
// Download (on by default) and Upload (off by default, with a warning) nested
// underneath it; one downlink MU-MIMO switch on a Wi-Fi 5 band.
import 'virtual:milkflint-themes.css';
import '@/styles.css';
import { type ReactElement, useState } from 'react';
import { afterEach, expect, test } from 'vitest';
import { cleanup, render } from 'vitest-browser-react';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { MuruStatus } from '@/lib/api/wireless';
import { airtimeBandDefaults } from '@/features/wifi/airtime';
import type { RadioForm } from '@/features/wifi/model';
import { MURU_DEFAULTS } from '@/features/wifi/muru';
import { twtOf } from '@/features/wifi/twt';
import { MuruSection } from '@/features/wifi-driver/sections';

function sampleBand(more: Partial<RadioForm> = {}): RadioForm {
  return {
    radio: 'radio1',
    band: '5g',
    enabled: true,
    channel: '36',
    modePrefix: 'HE',
    width: '160',
    requireMode: '',
    txpower: '',
    allowDfs: true,
    iface: 'default_radio1',
    ssid: 'home',
    encryption: 'sae-mixed',
    cipher: '',
    key: 'correct horse',
    hidden: false,
    randomBssid: false,
    beamforming: true,
    muMimo: true,
    spr: { mode: 'auto', threshold: -72 },
    qosMap: '',
    twt: twtOf(undefined, () => undefined),
    holdBack: 'short',
    airtime: true,
    airtimeBands: { ...airtimeBandDefaults('5g'), auto: 'balanced' },
    multicastToUnicast: false,
    muru: { ...MURU_DEFAULTS },
    ...more,
  };
}

/** What the driver reports with its defaults */
const DEFAULT_NOW: MuruStatus = {
  running: true,
  supported: true,
  ofdma_dl: true,
  ofdma_ul: false,
  mimo_dl: true,
  mimo_ul: false,
};

function Harness({ band = {}, now = DEFAULT_NOW }: { band?: Partial<RadioForm>; now?: MuruStatus }): ReactElement {
  const [form, setForm] = useState<RadioForm>(() => sampleBand(band));
  return (
    <TooltipProvider>
      <MuruSection
        forms={[form]}
        options={{
          radio1: {
            channels: [],
            txpowers: [],
            htmodes: undefined,
            dfs: [],
            cacMs: {},
            spr: undefined,
            twtLimits: false,
            muru: now,
          },
        }}
        set={() => (key, value) => {
          setForm((prev) => ({ ...prev, [key]: value }));
        }}
      />
      {/* the form's flags, for the tests to read */}
      <output data-testid="muru">{JSON.stringify(form.muru)}</output>
    </TooltipProvider>
  );
}

afterEach(async () => {
  await cleanup();
});

test('master toggle reveals download (on) and upload (off with warning), and collapses when turned off', async () => {
  const screen = await render(<Harness />);
  const master = screen.getByRole('switch', { name: 'MU-MIMO & OFDMA' });
  const mimoDl = screen.getByRole('switch', { name: 'Downlink MU-MIMO' });
  const ofdmaDl = screen.getByRole('switch', { name: 'Downlink OFDMA' });
  const mimoUl = screen.getByRole('switch', { name: 'Uplink MU-MIMO' });
  const ofdmaUl = screen.getByRole('switch', { name: 'Uplink OFDMA' });

  await expect.element(master).toHaveAttribute('aria-checked', 'true');
  await expect.element(mimoDl).toHaveAttribute('aria-checked', 'true');
  await expect.element(ofdmaDl).toHaveAttribute('aria-checked', 'true');
  await expect.element(mimoUl).toHaveAttribute('aria-checked', 'false');
  await expect.element(ofdmaUl).toHaveAttribute('aria-checked', 'false');
  await expect.element(screen.getByText(/periodic Wi-Fi pauses and latency spikes/)).toBeVisible();
  await expect.element(screen.getByText('In use now: download MU-MIMO, download OFDMA.')).toBeVisible();
  await expect.element(screen.getByText(/Needs beamforming and MU-MIMO on/)).not.toBeInTheDocument();

  await master.click();
  await expect.element(master).toHaveAttribute('aria-checked', 'false');
  await expect.element(mimoDl).not.toBeInTheDocument();
  await expect.element(mimoUl).not.toBeInTheDocument();
  await expect
    .element(screen.getByTestId('muru'))
    .toHaveTextContent(JSON.stringify({ mimoDl: false, ofdmaDl: false, mimoUl: false, ofdmaUl: false }));

  await master.click();
  await expect.element(master).toHaveAttribute('aria-checked', 'true');
  await expect.element(mimoDl).toHaveAttribute('aria-checked', 'true');
  await expect.element(ofdmaDl).toHaveAttribute('aria-checked', 'true');
  await expect.element(mimoUl).toHaveAttribute('aria-checked', 'false');
  await expect.element(ofdmaUl).toHaveAttribute('aria-checked', 'false');

  await mimoUl.click();
  await expect.element(mimoUl).toHaveAttribute('aria-checked', 'true');
  await expect.element(ofdmaUl).toHaveAttribute('aria-checked', 'false');
  await expect
    .element(screen.getByTestId('muru'))
    .toHaveTextContent(JSON.stringify({ mimoDl: true, ofdmaDl: true, mimoUl: true, ofdmaUl: false }));
});

test('the last flag switched off turns the master off too', async () => {
  const screen = await render(<Harness />);
  await screen.getByRole('switch', { name: 'Downlink MU-MIMO' }).click();
  await screen.getByRole('switch', { name: 'Downlink OFDMA' }).click();
  await expect.element(screen.getByRole('switch', { name: 'MU-MIMO & OFDMA' })).toHaveAttribute('aria-checked', 'false');
  await expect.element(screen.getByRole('switch', { name: 'Uplink MU-MIMO' })).not.toBeInTheDocument();
});

test('MU-MIMO off in Networks & radios: the switch says so and "In use now" leaves it out', async () => {
  const screen = await render(<Harness band={{ muMimo: false }} />);
  await expect.element(screen.getByText(/Needs beamforming and MU-MIMO on/)).toBeVisible();
  await expect.element(screen.getByText('In use now: download OFDMA.')).toBeVisible();
});

test('a Wi-Fi 5 band has one switch, downlink MU-MIMO', async () => {
  const screen = await render(<Harness band={{ modePrefix: 'VHT', width: '80' }} />);
  const mimoDl = screen.getByRole('switch', { name: 'Downlink MU-MIMO' });
  await expect.element(mimoDl).toHaveAttribute('aria-checked', 'true');
  await expect.element(screen.getByRole('switch', { name: 'MU-MIMO & OFDMA' })).not.toBeInTheDocument();
  await expect.element(screen.getByRole('switch', { name: 'Downlink OFDMA' })).not.toBeInTheDocument();
  await expect.element(screen.getByRole('switch', { name: 'Uplink MU-MIMO' })).not.toBeInTheDocument();
  await expect.element(screen.getByText(/periodic Wi-Fi pauses/)).not.toBeInTheDocument();
  // the driver's DL OFDMA flag is on, but Wi-Fi 5 can't use it
  await expect.element(screen.getByText('In use now: download MU-MIMO.')).toBeVisible();

  await mimoDl.click();
  await expect.element(mimoDl).toHaveAttribute('aria-checked', 'false');
  await expect
    .element(screen.getByTestId('muru'))
    .toHaveTextContent(JSON.stringify({ mimoDl: false, ofdmaDl: false, mimoUl: false, ofdmaUl: false }));
  await mimoDl.click();
  await expect
    .element(screen.getByTestId('muru'))
    .toHaveTextContent(JSON.stringify({ mimoDl: true, ofdmaDl: true, mimoUl: false, ofdmaUl: false }));
});

test('an older Wi-Fi mode gets a pointer to Networks & radios, no switches', async () => {
  const screen = await render(<Harness band={{ modePrefix: 'HT', width: '40' }} />);
  await expect.element(screen.getByText(/Needs Wi-Fi 5 or newer/)).toBeVisible();
  await expect.element(screen.getByRole('link', { name: 'Change it on Networks & radios' })).toBeVisible();
  await expect.element(screen.getByRole('switch', { name: 'Downlink MU-MIMO' })).not.toBeInTheDocument();
});

test('nothing "in use" is shown while the radio is off or the driver has no such file', async () => {
  const off = await render(<Harness now={{ ...DEFAULT_NOW, running: false }} />);
  await expect.element(off.getByText(/In use now/)).not.toBeInTheDocument();
  await cleanup();
  const unsupported = await render(
    <Harness now={{ running: true, supported: false, ofdma_dl: null, ofdma_ul: null, mimo_dl: null, mimo_ul: null }} />,
  );
  await expect.element(unsupported.getByText(/In use now/)).not.toBeInTheDocument();
  await expect.element(unsupported.getByRole('switch', { name: 'MU-MIMO & OFDMA' })).toBeVisible();
});
