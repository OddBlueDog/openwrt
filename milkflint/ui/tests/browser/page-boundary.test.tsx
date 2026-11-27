// PageBoundary around a page's must-have read: the skeleton while it loads,
// the load error with a retry that reads again, and a refresh that fails
// after the data came keeps the data on screen.
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup } from 'vitest-browser-react';
import { PageBoundary } from '@/components/page-boundary';
import { settingsQuery } from '@/lib/query/options';
import { renderWithProviders } from './render';

afterEach(async () => {
  await cleanup();
  vi.restoreAllMocks();
});

function Settings({ load }: { load: () => Promise<string> }): ReactElement {
  const { data } = useSuspenseQuery(settingsQuery(['test', 'boundary'], load));
  const client = useQueryClient();
  return (
    <>
      <p>saved: {data}</p>
      <button
        type="button"
        onClick={() => {
          void client.invalidateQueries();
        }}
      >
        refresh
      </button>
    </>
  );
}

test('while the read is on its way, the skeleton shows', async () => {
  const screen = await renderWithProviders(
    <PageBoundary>
      <Settings load={() => new Promise(() => undefined)} />
    </PageBoundary>,
  );
  await vi.waitFor(() => {
    expect(document.querySelector('[data-slot="skeleton"]')).not.toBeNull();
  });
  expect(screen.getByText(/^saved:/).elements()).toHaveLength(0);
});

test('a read that fails shows the load error; Try again reads again and shows the data', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  let fail = true;
  const load = vi.fn(() => (fail ? Promise.reject(new Error('The router is not responding')) : Promise.resolve('on')));
  const screen = await renderWithProviders(
    <PageBoundary>
      <Settings load={load} />
    </PageBoundary>,
  );
  await expect.element(screen.getByText("Couldn't load the settings")).toBeVisible();
  await expect.element(screen.getByText(/The router is not responding/)).toBeVisible();
  fail = false;
  await screen.getByRole('button', { name: 'Try again' }).click();
  await expect.element(screen.getByText('saved: on')).toBeVisible();
  expect(load).toHaveBeenCalledTimes(2);
});

test('a refresh that fails after the data came keeps showing the data', async () => {
  let fail = false;
  const load = vi.fn(() => (fail ? Promise.reject(new Error('router away')) : Promise.resolve('on')));
  const screen = await renderWithProviders(
    <PageBoundary>
      <Settings load={load} />
    </PageBoundary>,
  );
  await expect.element(screen.getByText('saved: on')).toBeVisible();
  fail = true;
  await screen.getByRole('button', { name: 'refresh' }).click();
  await vi.waitFor(() => {
    expect(load).toHaveBeenCalledTimes(2);
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  await expect.element(screen.getByText('saved: on')).toBeVisible();
  expect(screen.getByText("Couldn't load the settings").elements()).toHaveLength(0);
});
