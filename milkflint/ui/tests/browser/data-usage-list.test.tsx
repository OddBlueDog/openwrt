// Data usage's By device list in a real browser, against the pretend
// router's busy household: busiest first, each figure and the name sort
// from their headings (an unnamed device last), and a long list comes 50 at
// a time with Show more instead of being cut.
import 'virtual:milkflint-themes.css';
import '@/styles.css';
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup } from 'vitest-browser-react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { DataStatisticsPage } from '@/features/data-statistics/page';
import type * as Ubus from '@/lib/ubus';
import { renderWithProviders } from './render';

/** How many devices the router counted: the busy household's 8, or a long list. */
const counted = vi.hoisted(() => ({ many: false }));

vi.mock('@/lib/ubus', async (importOriginal) => {
  const real = await importOriginal<typeof Ubus>();
  return {
    ...real,
    call: async (object: string, method: string, params: Record<string, unknown>, schema: { parse: (v: unknown) => unknown }) => {
      const { answer } = await import('./router');
      let raw = answer('busy', object, method, params);
      if (counted.many && `${object} ${method}` === 'milkflint.traffic usage') {
        raw = {
          columns: ['mac', 'ip', 'conns', 'rx_bytes', 'rx_pkts', 'tx_bytes', 'tx_pkts'],
          data: Array.from({ length: 60 }, (_, i) => [
            `02:00:00:00:00:${i.toString(16).padStart(2, '0')}`,
            `10.0.0.${String(i + 1)}`,
            10,
            1_000_000 * (60 - i),
            1,
            1000,
            1,
          ]),
        };
      }
      if (raw === undefined) throw new real.UbusError(object, method, real.UbusStatus.methodNotFound);
      return schema.parse(raw);
    },
  };
});

afterEach(async () => {
  counted.many = false;
  await cleanup();
});

const TABLE = 'table[aria-label="Data usage by device"]';
const firstCells = (): string[] =>
  [...document.querySelectorAll(`${TABLE} tbody tr`)].map((tr) => tr.querySelector('td span')?.firstChild?.textContent ?? '');
async function draw(): Promise<Awaited<ReturnType<typeof renderWithProviders>>> {
  window.location.hash = '#/data-statistics';
  const screen = await renderWithProviders(
    <TooltipProvider>
      <DataStatisticsPage />
    </TooltipProvider>,
  );
  await expect.element(screen.getByRole('table', { name: 'Data usage by device' })).toBeVisible();
  return screen;
}

test('busiest first; Download sorts biggest first, turns round, then busiest first again; names A to Z', async () => {
  const screen = await draw();
  await vi.waitFor(() => {
    expect(firstCells()).toHaveLength(8);
  });
  const busiest = firstCells();
  const download = screen.getByRole('columnheader', { name: 'Download' });
  await download.getByRole('button').click();
  await expect.element(download).toHaveAttribute('aria-sort', 'descending');
  expect(firstCells()).toEqual(busiest);
  await download.getByRole('button').click();
  expect(firstCells()).toEqual(busiest.toReversed());
  await download.getByRole('button').click();
  await expect.element(download).not.toHaveAttribute('aria-sort');
  expect(firstCells()).toEqual(busiest);

  await screen.getByRole('columnheader', { name: 'Device' }).getByRole('button').click();
  const named = firstCells().filter((n) => n !== 'Unnamed device');
  expect(named).toEqual(named.toSorted((a, b) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' })));
  expect(
    firstCells()
      .slice(named.length)
      .every((n) => n === 'Unnamed device'),
  ).toBe(true);
  // the share is a bar, not something to sort by
  expect(screen.getByRole('columnheader', { name: 'Share' }).getByRole('button').elements()).toHaveLength(0);
});

test('a long list: 50 at a time with Show more, sorted as a whole', async () => {
  counted.many = true;
  const screen = await draw();
  await vi.waitFor(() => {
    expect(firstCells()).toHaveLength(50);
  });
  await expect.element(screen.getByText('Showing 50 of 60.')).toBeVisible();
  // the least busy ten are past the first 50, and come first turned round
  const download = screen.getByRole('columnheader', { name: 'Download' });
  await download.getByRole('button').click();
  await download.getByRole('button').click();
  expect(document.querySelector(`${TABLE} tbody tr`)?.textContent).toContain('10.0.0.60');
  await screen.getByRole('button', { name: 'Show 10 more' }).click();
  expect(firstCells()).toHaveLength(60);
});
