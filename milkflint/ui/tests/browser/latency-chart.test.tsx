// Network Quality's latency chart on TanStack Charts: the plot named for its
// span, a hover that reads every line at one time (with a worst behind a
// typical, and a lost probe said as lost), one mark at the top for a spike
// above the scale, and the loss strip's card for a slice.
import 'virtual:milkflint-themes.css';
import '@/styles.css';
import { afterEach, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { cleanup } from 'vitest-browser-react';
import { LatencyChart } from '@/features/network-quality/latency-chart';
import type { ChartLine, LinePoint } from '@/features/network-quality/chart-data';
import { renderWithProviders } from './render';

afterEach(cleanup);

const start = 1_790_000_000;
const end = start + 3600;
// an hour of 5-second rounds: 9–11 ms, one 1.8 s stall, one lost probe, and a
// point standing for several probes with a worst behind it
const points = (base: number): LinePoint[] =>
  Array.from({ length: 720 }, (_, i): LinePoint => {
    const t = start + i * 5;
    if (i === 360) return { t, v: base + 1800, lost: 0, rounds: 1 };
    if (i === 200) return { t, v: undefined, lost: 1, rounds: 1 };
    if (i === 100) return { t, v: base, worst: base + 30, lost: 0, rounds: 3 };
    return { t, v: base + (i % 3), lost: 0, rounds: 1 };
  });
const lines: ChartLine[] = [
  { key: 'internet', label: 'Internet', color: 'var(--chart-1)', points: points(9), countLoss: true },
  { key: 'dns', label: 'DNS', color: 'var(--chart-2)', points: points(14), countLoss: true },
];

async function draw(): Promise<Awaited<ReturnType<typeof renderWithProviders>>> {
  await page.viewport(1000, 800);
  return renderWithProviders(
    <div style={{ width: 800 }} className="bg-card p-4 pl-16">
      <LatencyChart
        label="Latency"
        lines={lines}
        start={start}
        end={end}
        spanLabel="hour"
        format={(v) => `${String(Math.round(v))} ms`}
        hoverFormat={(v) => `${String(Math.round(v))} ms`}
        csv={() => Promise.resolve({ name: 'x.csv', text: '' })}
      />
    </div>,
  );
}

test('the plot, named for its span, with a mark at the top for the spike above its scale', async () => {
  const screen = await draw();
  const plot = screen.getByRole('img', { name: 'Latency over the last hour' });
  await expect.element(plot).toBeVisible();
  await expect.element(screen.getByText(/The scale stops at/)).toBeVisible();
  // the stall on each line is above the scale: one ▲ each, in its colour
  await vi.waitFor(() => {
    const marks = [...plot.element().querySelectorAll('text')].filter((t) => t.textContent === '▲');
    expect(marks.map((m) => m.getAttribute('fill')).sort()).toEqual(['var(--chart-1)', 'var(--chart-2)']);
  });
});

test('hovering reads both lines at one time, the worst behind a typical, a lost probe as lost', async () => {
  const screen = await draw();
  const plot = screen.getByRole('img', { name: 'Latency over the last hour' });
  await expect.element(plot).toBeVisible();
  const box = plot.element().getBoundingClientRect();
  // the plot starts 56 px in (the scale's labels) and runs to the right edge
  const xAt = (i: number): number => 56 + ((box.width - 56) * i) / 719;
  await userEvent.hover(plot, { position: { x: xAt(100), y: box.height / 2 } });
  await vi.waitFor(() => {
    const card = document.querySelector('.mf-chart-tooltip')?.textContent ?? '';
    expect(card).toContain('Internet');
    expect(card).toContain('DNS');
    expect(card).toContain('worst 39 ms');
  });
  await userEvent.hover(plot, { position: { x: xAt(200), y: box.height / 2 } });
  await vi.waitFor(() => {
    expect(document.querySelector('.mf-chart-tooltip')?.textContent).toContain('lost');
  });
});

test('the loss strip names what was lost, and its card says when and on which lines', async () => {
  const screen = await draw();
  const strip = screen.getByRole('img', { name: /Probes lost at 1 points/ });
  await expect.element(strip).toBeVisible();
  const box = strip.element().getBoundingClientRect();
  // the lost probe is 200 rounds of 720 in: its slice of 240
  await userEvent.hover(strip, { position: { x: box.width * (200.5 / 720), y: box.height / 2 } });
  await vi.waitFor(() => {
    const card = [...document.querySelectorAll('.mf-chart-tooltip')].map((c) => c.textContent).join(' ');
    expect(card).toContain('1 of');
    expect(card).toContain('lost');
  });
});
