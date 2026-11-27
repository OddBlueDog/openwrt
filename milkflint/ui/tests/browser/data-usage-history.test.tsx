// Data Usage's 24-hour history in a real browser, against the pretend router's busy household: off, the card
// says so and the Counting card has the switch; on, the table lists the devices busiest first (the all-zero
// bucket left out), and a device's own view has its four windows and a chart of download and upload.
import 'virtual:milkflint-themes.css';
import '@/styles.css';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { cleanup } from 'vitest-browser-react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { DataStatisticsPage } from '@/features/data-statistics/page';
import type * as Ubus from '@/lib/ubus';
import { NOW } from './fixtures';
import { seenRecord, usageHistory } from './router';
import { renderWithProviders } from './render';

const sent = vi.hoisted(() => [] as string[]);
const router = vi.hoisted((): { scenario: 'busy' | 'quiet' } => ({ scenario: 'busy' }));
/** What the page asked uci to set, as `config.section.option=value`. */
const written = vi.hoisted(() => [] as string[]);

vi.mock('@/lib/ubus', async (importOriginal) => {
  const real = await importOriginal<typeof Ubus>();
  return {
    ...real,
    exec: (object: string, method: string, params: Record<string, unknown> = {}): Promise<void> => {
      if (object === 'uci' && method === 'set') {
        const values = params['values'] as Record<string, string>;
        for (const [k, v] of Object.entries(values))
          written.push(`${String(params['config'])}.${String(params['section'])}.${k}=${v}`);
      }
      return Promise.resolve();
    },
    call: async (object: string, method: string, params: Record<string, unknown>, schema: { parse: (v: unknown) => unknown }) => {
      sent.push(`${object} ${method}`);
      const { answer } = await import('./router');
      const raw = answer(router.scenario, object, method, params);
      if (raw === undefined) throw new real.UbusError(object, method, real.UbusStatus.methodNotFound);
      return schema.parse(raw);
    },
  };
});

const OFF =
  'Kept for a day: each hour’s figures are deleted 24 hours after that hour ends. Turning this off deletes them all at once.';
const DEVICE = '5c:e9:1e:00:03:a3';

beforeEach(() => {
  sent.length = 0;
  written.length = 0;
  router.scenario = 'busy';
});

afterEach(async () => {
  usageHistory.on = false;
  usageHistory.shape = 'busy';
  seenRecord.devices = {};
  await cleanup();
});

async function draw(hash: string): Promise<Awaited<ReturnType<typeof renderWithProviders>>> {
  window.location.hash = hash;
  const screen = await renderWithProviders(
    <TooltipProvider>
      <DataStatisticsPage />
    </TooltipProvider>,
  );
  await expect.element(screen.getByText('Counting', { exact: true })).toBeVisible();
  return screen;
}

test('off: the card says what it keeps and the Counting card has the switch; no table, nothing asked', async () => {
  const screen = await draw('#/data-statistics');
  await expect.element(screen.getByText(OFF)).toBeVisible();
  await expect.element(screen.getByRole('switch', { name: 'Keep a 24-hour history per device' })).not.toBeChecked();
  expect(screen.getByRole('table', { name: 'Data used in the last 24 hours' }).query()).toBeNull();
  expect(sent).not.toContain('milkflint.traffic history');
});

test('on: devices in 24 h order with the router’s bucket left out, a chart of the total, one request', async () => {
  usageHistory.on = true;
  const screen = await draw('#/data-statistics');
  await expect.element(screen.getByRole('switch', { name: 'Keep a 24-hour history per device' })).toBeChecked();
  const table = screen.getByRole('table', { name: 'Data used in the last 24 hours' });
  await expect.element(table).toBeVisible();
  const macs = await vi.waitFor((): string[] => {
    const rows = [...document.querySelectorAll('table[aria-label="Data used in the last 24 hours"] tbody tr')];
    expect(rows.length).toBe(8);
    return rows.map((r) => r.querySelector('td')?.textContent ?? '');
  });
  // eight devices, the heaviest (…07:a7) first; the all-zero bucket isn't one
  expect(macs[0]).toContain('5c:e9:1e:00:07:a7');
  expect(macs[7]).toBe('lounge-apple-tv-4k'); // the lightest, known by name
  expect(document.body.textContent).not.toContain('00:00:00:00:00:00');
  // the chart draws once its box is measured
  await vi.waitFor(() => {
    const chart = document.querySelector('svg[aria-label^="Download and upload"]');
    expect(chart?.querySelectorAll('path').length).toBe(2);
  });
  expect(document.body.textContent).toContain('Average speed in each 5 minutes');
  expect(document.body.textContent).toMatch(/History since \d\d:\d\d/);
  expect(sent.filter((c) => c === 'milkflint.traffic history').length).toBe(1);
});

test('a device’s view has its four windows and its own chart', async () => {
  usageHistory.on = true;
  const screen = await draw(`#/data-statistics/${DEVICE}`);
  for (const name of ['1 hour', '4 hours', '8 hours', '24 hours']) {
    await expect.element(screen.getByRole('heading', { name })).toBeVisible();
  }
  await vi.waitFor(() => {
    const chart = document.querySelector('svg[aria-label^="Download and upload"]');
    expect(chart?.querySelectorAll('path').length).toBe(2);
  });
  // 4 * 40 MB in 24 h; 4 * 40 MB / 10 uploaded
  expect(document.body.textContent).toContain('download 152.6 MB · upload 15.3 MB');
});

test('the switch saves milkflint.datastats.history: 1 when turned on, 0 when turned off', async () => {
  const screen = await draw('#/data-statistics');
  const toggle = screen.getByRole('switch', { name: 'Keep a 24-hour history per device' });
  await userEvent.click(toggle);
  await userEvent.click(screen.getByRole('button', { name: /Save/ }));
  await vi.waitFor(() => {
    expect(written).toEqual(['milkflint.datastats.history=1']);
  });
  await cleanup();
  written.length = 0;
  usageHistory.on = true;
  const again = await draw('#/data-statistics');
  await userEvent.click(again.getByRole('switch', { name: 'Keep a 24-hour history per device' }));
  await userEvent.click(again.getByRole('button', { name: /Save/ }));
  await vi.waitFor(() => {
    expect(written).toEqual(['milkflint.datastats.history=0']);
  });
});

test('while Data usage is off there is no history card or request, and the switch is disabled', async () => {
  router.scenario = 'quiet';
  usageHistory.on = true; // saved as on, but nothing is kept while counting is off
  const screen = await draw('#/data-statistics');
  await expect.element(screen.getByText('Data usage is off')).toBeVisible();
  await expect.element(screen.getByRole('switch', { name: 'Keep a 24-hour history per device' })).toBeDisabled();
  expect(document.body.textContent).not.toContain('Last 24 hours');
  expect(document.body.textContent).not.toContain('Average speed in each 5 minutes');
  expect(sent).not.toContain('milkflint.traffic history');
});

test('off: the card says it is off and where the switch is, and keeps the line about what it keeps', async () => {
  const screen = await draw('#/data-statistics');
  await expect
    .element(
      screen.getByText(
        'Off. Turn on Keep a 24-hour history per device under Counting to see each device’s last 1, 4, 8 and 24 hours.',
      ),
    )
    .toBeVisible();
  await expect.element(screen.getByText(OFF)).toBeVisible();
});

test('just turned on: the empty table says when the first figures come', async () => {
  usageHistory.on = true;
  usageHistory.shape = 'fresh';
  const screen = await draw('#/data-statistics');
  await expect.element(screen.getByText(/first figures come about 5 minutes after/)).toBeVisible();
});

test('running but nothing moved: an idle device’s view says nothing moved in the last 24 hours', async () => {
  usageHistory.on = true;
  usageHistory.shape = 'idle';
  const screen = await draw(`#/data-statistics/${DEVICE}`);
  await expect.element(screen.getByText('Nothing moved in the last 24 hours')).toBeVisible();
});

test('while Data usage is off and the history is on, the note says the history is deleted too', async () => {
  router.scenario = 'quiet';
  usageHistory.on = true;
  const screen = await draw('#/data-statistics');
  await expect.element(screen.getByText(/The 24-hour history is deleted\./).first()).toBeVisible();
});

test('the device view shows the first-seen line the sheet shows', async () => {
  seenRecord.devices = { [DEVICE]: [NOW - 20 * 86400, NOW - 3600] };
  const { firstSeenText } = await import('@/lib/api/seen');
  const expected = firstSeenText({ since: seenRecord.since, devices: seenRecord.devices }, DEVICE);
  expect(expected).toMatch(/^First seen /);
  await draw(`#/data-statistics/${DEVICE}`);
  await vi.waitFor(() => {
    expect(document.body.textContent).toContain(expected);
  });
});
