// TimeChart, the line chart over time every graph draws with (TanStack
// Charts): it takes its box's size, names itself for screen readers, draws a
// path per line run, and hovering shows the time and each line's value; a
// set of ticks in each colour; a plot pinned where `left` says.
import 'virtual:milkflint-themes.css';
import '@/styles.css';
import { afterAll, afterEach, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { cleanup } from 'vitest-browser-react';
import { TimeChart } from '@/components/charts/time-chart';
import { setThemeId } from '@/lib/theme';
import { DEFAULT_THEME_ID } from '@/theme/themes';
import type * as Ubus from '@/lib/ubus';
import { renderWithProviders } from './render';

// the pretend router in place of lib/ubus.ts's call (choosing a theme saves it): see core-rings.test.tsx
vi.mock('@/lib/ubus', async (importOriginal) => {
  const real = await importOriginal<typeof Ubus>();
  return {
    ...real,
    call: async (object: string, method: string, params: Record<string, unknown>, schema: { parse: (v: unknown) => unknown }) => {
      const { answer } = await import('./router');
      const raw = answer('busy', object, method, params);
      if (raw === undefined) throw new real.UbusError(object, method, real.UbusStatus.methodNotFound);
      return schema.parse(raw);
    },
  };
});

afterEach(cleanup);
afterAll(() => setThemeId(DEFAULT_THEME_ID));

const from = 1_790_000_000;
const pts = (f: (i: number) => number | null): [number, number | null][] =>
  Array.from({ length: 30 }, (_, i) => [from + i * 2, f(i)] as [number, number | null]);

test('a chart of its box, named, with its lines, and a hover that reads each line', async () => {
  await page.viewport(900, 600);
  const screen = await renderWithProviders(
    <div style={{ width: 600 }} className="bg-card p-4">
      <TimeChart
        lines={[
          { label: 'Download', color: 'var(--chart-2)', points: pts((i) => 40 + 30 * Math.sin(i / 3)), area: true },
          { label: 'Upload', color: 'var(--chart-1)', points: pts((i) => (i === 12 ? null : 10 + i)), area: true },
        ]}
        from={from}
        to={from + 58}
        max={100}
        step={2}
        format={(v) => `${String(Math.round(v))} Mbit/s`}
        label="Download and upload"
        xLabels={[
          { t: from, label: '1 min ago' },
          { t: from + 58, label: 'Now' },
        ]}
        className="h-36"
      />
    </div>,
  );
  const chart = screen.getByRole('img', { name: 'Download and upload' });
  await expect.element(chart).toBeVisible();
  const box = chart.element().getBoundingClientRect();
  expect(Math.round(box.width)).toBeGreaterThan(500);
  await userEvent.hover(chart, { position: { x: box.width / 2, y: box.height / 2 } });
  // every line's value at that time, not only the first line's
  await vi.waitFor(() => {
    const card = document.querySelector('.ts-chart-tooltip')?.textContent ?? '';
    expect(card).toMatch(/Download\d+ Mbit\/s/);
    expect(card).toMatch(/Upload\d+ Mbit\/s/);
  });
});

test('a set of ticks along the foot in each colour, and a plot from `left` to the right edge', async () => {
  await renderWithProviders(
    <div style={{ width: 500 }}>
      <TimeChart
        lines={[{ label: 'Ping', color: 'var(--chart-1)', points: pts((i) => i) }]}
        from={from}
        to={from + 58}
        max={40}
        step={2}
        format={String}
        label="Pings"
        marks={[
          { label: 'Mac', color: 'var(--chart-2)', times: [from + 10, from + 20] },
          { label: 'PC', color: 'var(--chart-3)', times: [from + 30] },
        ]}
        left={88}
      />
    </div>,
  );
  await vi.waitFor(() => {
    const ticks = [...document.querySelectorAll('svg[aria-label="Pings"] .ts-chart__link line')];
    expect(ticks.map((t) => t.getAttribute('stroke'))).toEqual(['var(--chart-2)', 'var(--chart-2)', 'var(--chart-3)']);
    const grid = document.querySelector('svg[aria-label="Pings"] .ts-chart__grid line');
    expect(grid?.getAttribute('x1')).toBe('88');
    expect(grid?.getAttribute('x2')).toBe('500');
  });
});

test('a theme that dashes its lines dashes them here, as the attribute TanStack writes', async () => {
  await setThemeId('minimamilk');
  await renderWithProviders(
    <div style={{ width: 400 }}>
      <TimeChart
        lines={[
          { label: 'Download', color: 'var(--chart-1)', points: pts((i) => i) },
          { label: 'Upload', color: 'var(--chart-2)', points: pts((i) => i / 2) },
        ]}
        from={from}
        to={from + 58}
        max={40}
        step={2}
        format={String}
        label="Two lines"
        className="h-24"
      />
    </div>,
  );
  // Minimamilk: series 1 '5 3', series 2 solid
  await vi.waitFor(() => {
    const lines = [...document.querySelectorAll('svg[aria-label="Two lines"] .ts-chart__line path')];
    expect(lines.map((p) => p.getAttribute('stroke-dasharray'))).toEqual(['5 3', null]);
  });
});
