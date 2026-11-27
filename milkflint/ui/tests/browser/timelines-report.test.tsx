// A test bench run's timelines (Over time) on TanStack Charts, from the
// made-up run of tests/test-bench-fixture.ts: each chart named, every plot
// lined up under the strip of phases, and hovering one chart shows that
// moment in all of them, every series read (the connection scans' and the
// Wi-Fi stations' sparser samples held to it); the router's pings tick the
// unanswered ones.
import 'virtual:milkflint-themes.css';
import '@/styles.css';
import { afterEach, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { cleanup } from 'vitest-browser-react';
import { Timelines } from '@/features/test-bench/timelines-report';
import { fixture } from '../test-bench-fixture';
import { renderWithProviders } from './render';

afterEach(cleanup);

const CHARTS = [
  'Latency to the internet',
  'Speed',
  'Smart Queue delay',
  'Smart Queue drops and marks',
  'Smart Queue backlog',
  'Router CPU per core',
  'Connections',
  'softnet',
  'Wi-Fi rate',
];

const cards = (): string[] =>
  [...document.querySelectorAll('.ts-chart-tooltip')].filter((c) => c.checkVisibility()).map((c) => c.textContent);

async function show(): Promise<void> {
  await page.viewport(1000, 2000);
  await renderWithProviders(
    <div style={{ width: 900 }} className="bg-card p-4">
      <Timelines data={fixture()} />
    </div>,
  );
  // a line chart draws once it has measured its box
  await expect.element(page.getByRole('img', { name: 'Wi-Fi rate' })).toBeVisible();
}

test('its charts, named, each plot from the phases’ left edge to their right', async () => {
  await show();
  const phases = page.getByLabelText('The run’s phases').element().getBoundingClientRect();
  for (const name of CHARTS) {
    const chart = page.getByRole('img', { name });
    await expect.element(chart).toBeVisible();
    const svg = chart.element();
    const box = svg.getBoundingClientRect();
    // the plot's edges: a line chart's grid, the CPU chart's rows
    const edge = svg.querySelector('.ts-chart__grid line, .ts-chart__band-y rect');
    const x1 = Number(edge?.getAttribute('x1') ?? edge?.getAttribute('x'));
    const x2 = Number(edge?.getAttribute('x2') ?? x1 + Number(edge?.getAttribute('width')));
    expect(Math.abs(box.left + x1 - phases.left), name).toBeLessThan(1);
    expect(Math.abs(box.left + x2 - phases.right), name).toBeLessThan(1);
  }
});

test('hovering one chart shows that moment in every chart, each series read', async () => {
  await show();
  expect(cards()).toEqual([]);
  const speed = page.getByRole('img', { name: 'Speed' });
  const box = speed.element().getBoundingClientRect();
  // 12 s in: the Mac's download
  await userEvent.hover(speed, { position: { x: 88 + ((box.width - 88) * 12) / 26, y: box.height / 2 } });
  await vi.waitFor(() => {
    expect(cards()).toHaveLength(CHARTS.length);
  });
  const shown = cards();
  for (const c of shown) expect(c.startsWith('0:12'), c).toBe(true);
  expect(shown.join('\n')).not.toContain('—');
  expect(shown).toContain('0:12Internet line, download9.6 Mbit/sInternet line, upload0 Mbit/sMac, download10 Mbit/s');
  expect(shown).toContain('0:12CPU 050% · softirq 10%CPU 110% · softirq 2%');
  // a scan every 10 s, the stations every 2 s
  expect(shown).toContain('0:12Tracked52Offloaded9');
  expect(shown).toContain('0:12Mac800 Mbit/s');

  // and from the CPU chart, the others follow
  const cores = page.getByRole('img', { name: 'Router CPU per core' });
  const strip = cores.element().getBoundingClientRect();
  await userEvent.hover(cores, { position: { x: 88 + ((strip.width - 88) * 21.5) / 26, y: 8 } });
  await vi.waitFor(() => {
    const now = cards();
    expect(now).toHaveLength(CHARTS.length);
    for (const c of now) expect(c.startsWith('0:22'), c).toBe(true);
  });
});

test('the router’s pings tick the ones its device didn’t answer, in its colour', async () => {
  await show();
  await page.getByRole('button', { name: 'Router’s pings' }).click();
  await expect.element(page.getByRole('img', { name: 'Latency router’s pings' })).toBeVisible();
  // the Mac's one lost of 100; the PC never answers, so it's left out
  const ticks = [...document.querySelectorAll('svg[aria-label="Latency router’s pings"] .ts-chart__link line')];
  expect(ticks.map((t) => t.getAttribute('stroke'))).toEqual(['var(--chart-2)']);
});
