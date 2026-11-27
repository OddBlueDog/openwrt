// BarChart, the bar chart every bar graph draws with (TanStack Charts): it
// takes its box's height, names itself for screen readers, stacks a bar's
// parts in their own colours, leaves a space for a null, and hovering a bar
// shows its card, a bar of no parts too.
import 'virtual:milkflint-themes.css';
import '@/styles.css';
import { afterEach, expect, test } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { cleanup } from 'vitest-browser-react';
import { type BarPart, BarChart } from '@/components/charts/bar-chart';
import { renderWithProviders } from './render';

afterEach(cleanup);

const stack = (a: number, b: number): BarPart[] => [
  { value: a, color: 'var(--primary)' },
  { value: b, color: 'var(--warning)' },
];
// two stacked bars, a space, one not measured, one of a single part
const bars = [stack(0.5, 0.25), stack(0.25, 0.5), null, [], [{ value: 1, color: 'var(--destructive)' }]];

test('a chart of its box, named, its bars stacked, and a hover that shows the bar’s card', async () => {
  await page.viewport(900, 600);
  const screen = await renderWithProviders(
    <div style={{ width: 500 }} className="bg-card p-4">
      <BarChart
        bars={bars}
        max={1}
        label="Three bars and a gap"
        card={(at) =>
          bars[at]?.length === 0
            ? { title: `Bar ${String(at)}`, rows: [{ label: 'Not measured', value: '' }] }
            : {
                title: `Bar ${String(at)}`,
                rows: (bars[at] ?? []).map((p, i) => ({ label: `Part ${String(i)}`, value: String(p.value), color: p.color })),
              }
        }
        scale={{ ticks: [1, 0.5], format: (v) => `${String(v * 100)}%` }}
        labels={[
          { at: 0, text: 'First', align: 'start' },
          { at: 4, text: 'Last', align: 'end' },
        ]}
        className="h-32"
      />
    </div>,
  );
  const chart = screen.getByRole('img', { name: 'Three bars and a gap' });
  await expect.element(chart).toBeVisible();
  const box = chart.element().getBoundingClientRect();
  expect(Math.round(box.height)).toBe(128);
  // each part is a bar of its own, in its own colour, and the unmeasured bar has a place (unpainted)
  const painted = [...chart.element().querySelectorAll('.ts-chart__bar-y path')].map((r) => r.getAttribute('fill'));
  expect(painted).toEqual([
    'var(--primary)',
    'var(--warning)',
    'var(--primary)',
    'var(--warning)',
    'transparent',
    'var(--destructive)',
  ]);
  await expect.element(screen.getByText('First')).toBeInTheDocument();
  await expect.element(screen.getByText('50%').first()).toBeInTheDocument();

  // the second bar: its card, a line per part
  await userEvent.hover(chart, { position: { x: box.width * 0.3, y: box.height / 2 } });
  await expect.element(page.getByText('Bar 1')).toBeVisible();
  await expect.element(page.getByText('Part 1')).toBeVisible();
  // the bar that wasn't measured can be hovered too
  await userEvent.hover(chart, { position: { x: box.width * 0.7, y: box.height / 2 } });
  await expect.element(page.getByText('Not measured')).toBeVisible();
});
