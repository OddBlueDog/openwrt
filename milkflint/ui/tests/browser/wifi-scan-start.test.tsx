// A Wi-Fi scan is a mutation the scan's live state then follows: starting one
// asks the router for the state again at once, and a refusal shows its reason.
import type { ReactElement } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup } from 'vitest-browser-react';
import { useStartWifiScan, wifiScanQueries } from '@/features/wifi-scan/queries';
import { useLive } from '@/lib/query/use-live';
import type * as Ubus from '@/lib/ubus';
import { renderWithProviders } from './render';

const router = vi.hoisted(() => ({ calls: [] as string[], refuse: false, state: 'done' }));

vi.mock('@/lib/ubus', async (importOriginal) => {
  const real = await importOriginal<typeof Ubus>();
  return {
    ...real,
    call: (object: string, method: string, _params: Record<string, unknown>, schema: { parse: (v: unknown) => unknown }) => {
      router.calls.push(`${object} ${method}`);
      if (method === 'start') {
        if (router.refuse) return Promise.resolve(schema.parse({ error: 'busy' }));
        router.state = 'running';
        return Promise.resolve(schema.parse({ started: true }));
      }
      return Promise.resolve(schema.parse({ state: router.state, now: 1000 }));
    },
  };
});

afterEach(async () => {
  router.calls.length = 0;
  router.refuse = false;
  router.state = 'done';
  await cleanup();
});

function Scan(): ReactElement {
  const scan = useLive(wifiScanQueries.scan(60_000));
  const start = useStartWifiScan();
  return (
    <>
      <p>state: {scan.data?.state ?? '…'}</p>
      {start.error !== null && <p role="alert">{start.error.message}</p>}
      <button
        type="button"
        onClick={() => {
          start.mutate(['phy0']);
        }}
      >
        Scan
      </button>
    </>
  );
}

test('starting a scan reads its state again at once', async () => {
  const screen = await renderWithProviders(<Scan />);
  await expect.element(screen.getByText('state: done')).toBeVisible();
  await screen.getByRole('button', { name: 'Scan' }).click();
  await expect.element(screen.getByText('state: running')).toBeVisible();
  expect(router.calls).toEqual(['milkflint.wifiscan results', 'milkflint.wifiscan start', 'milkflint.wifiscan results']);
});

test('a refused scan says why', async () => {
  router.refuse = true;
  const screen = await renderWithProviders(<Scan />);
  await expect.element(screen.getByText('state: done')).toBeVisible();
  await screen.getByRole('button', { name: 'Scan' }).click();
  await expect.element(screen.getByRole('alert')).toHaveTextContent('A scan is already running.');
});
