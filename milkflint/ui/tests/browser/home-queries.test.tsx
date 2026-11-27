// Home's reads: two widgets on one query make one call, against the pretend
// router's busy household; and Home's figures take each reading once, so a
// re-render never adds a sample to the history twice.
import { type ReactElement, useState } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup } from 'vitest-browser-react';
import { dashboardQueries } from '@/features/dashboard/queries';
import { useDashboard } from '@/features/dashboard/use-dashboard';
import { useLive } from '@/lib/query/use-live';
import type * as Readings from '@/features/dashboard/readings';
import type * as Ubus from '@/lib/ubus';
import { renderWithProviders } from './render';

const calls = vi.hoisted(() => new Map<string, number>());
const worked = vi.hoisted(() => ({ count: 0 }));

// Home's figures from each reading, cut down to what this test looks at: a reading is its
// time, and each one worked out adds one sample to the history it carries
vi.mock('@/features/dashboard/readings', async (importOriginal) => {
  const real = await importOriginal<typeof Readings>();
  return {
    ...real,
    getReadings: () => {
      const t = Date.now() / 1000;
      return Promise.resolve({ at: performance.now(), t });
    },
    nextDashboard: (r: { t: number }, _n: unknown, _b: unknown, carry: { history: { t: number }[] }) => {
      worked.count++;
      const history = [...carry.history, { t: r.t }];
      return { dashboard: { history }, carry: { ...carry, history } };
    },
  };
});

vi.mock('@/lib/ubus', async (importOriginal) => {
  const real = await importOriginal<typeof Ubus>();
  return {
    ...real,
    call: async (object: string, method: string, params: Record<string, unknown>, schema: { parse: (v: unknown) => unknown }) => {
      const what = `${object}.${method}`;
      calls.set(what, (calls.get(what) ?? 0) + 1);
      const { answer } = await import('./router');
      const raw = answer('busy', object, method, params);
      if (raw === undefined) throw new real.UbusError(object, method, real.UbusStatus.methodNotFound);
      return schema.parse(raw);
    },
  };
});

afterEach(async () => {
  await cleanup();
  calls.clear();
  worked.count = 0;
});

function Banip({ name }: { name: string }): ReactElement {
  const { data } = useLive(dashboardQueries.banip());
  return <p>{data === undefined ? `${name} reading` : `${name} read`}</p>;
}

test('two widgets on one query make one call', async () => {
  const screen = await renderWithProviders(
    <>
      <Banip name="card" />
      <Banip name="tile" />
    </>,
  );
  await expect.element(screen.getByText('card read')).toBeVisible();
  await expect.element(screen.getByText('tile read')).toBeVisible();
  expect(calls.get('milkflint.banip.status')).toBe(1);
});

function History(): ReactElement {
  const { data, at } = useDashboard();
  const [renders, setRenders] = useState(0);
  return (
    <>
      <p>{data === undefined ? 'waiting' : `${String(data.history.length)} samples at ${String(at)}`}</p>
      <button
        type="button"
        onClick={() => {
          setRenders((n) => n + 1);
        }}
      >
        render again ({renders})
      </button>
    </>
  );
}

test('a re-render never adds a sample twice; a new reading adds one', async () => {
  const screen = await renderWithProviders(<History />);
  await expect.element(screen.getByText(/^1 samples at/)).toBeVisible();
  for (let i = 0; i < 5; i++) await screen.getByRole('button', { name: /render again/ }).click();
  await expect.element(screen.getByText('render again (5)')).toBeVisible();
  await expect.element(screen.getByText(/^1 samples at/)).toBeVisible();
  expect(worked.count).toBe(1);
  // the next reading, 2 s on
  await expect.element(screen.getByText(/^2 samples at/), { timeout: 5000 }).toBeVisible();
  expect(worked.count).toBe(2);
});
