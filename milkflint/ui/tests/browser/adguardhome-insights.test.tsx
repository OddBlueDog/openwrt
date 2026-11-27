// What AdGuard Home is seeing, on its page: the window in the title, when it
// was read and how often, lookups and blocks over the window, the top lists
// with devices by the router's names, the first five until asked for the rest,
// and what it says while it has nothing to show.
import 'virtual:milkflint-themes.css';
import '@/styles.css';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup } from 'vitest-browser-react';
import { TooltipProvider } from '@/components/ui/tooltip';
import type * as Api from '@/features/adguardhome/api';
import { InsightsCard } from '@/features/adguardhome/insights';
import type * as Network from '@/lib/api/network';
import { renderWithProviders } from './render';

const AT = Date.UTC(2026, 10, 22, 13, 20) / 1000;

const answer: { insights: Api.AdGuardInsights; calls: number } = vi.hoisted(() => ({
  insights: { running: false },
  calls: 0,
}));

vi.mock('@/features/adguardhome/api', async (importOriginal) => {
  const real = await importOriginal<typeof Api>();
  return {
    ...real,
    getAdGuardInsights: () => {
      answer.calls++;
      return Promise.resolve(answer.insights);
    },
  };
});

vi.mock('@/lib/api/network', async (importOriginal) => {
  const real = await importOriginal<typeof Network>();
  return {
    ...real,
    getHostHints: () =>
      Promise.resolve({
        'aa:00:00:00:00:01': { name: 'sams-iphone.lan', ipaddrs: ['192.168.1.20'] },
        'aa:00:00:00:00:02': { name: 'living-room-tv', ipaddrs: ['192.168.1.21'] },
      }),
  };
});

const busy = (): Api.AdGuardInsights => ({
  running: true,
  at: AT,
  unit: 'hours',
  queries: Array.from({ length: 24 }, (_, i) => 100 + i * 10),
  blocked: Array.from({ length: 24 }, (_, i) => 10 + i),
  total: 6000,
  total_blocked: 540,
  top_queried: Array.from({ length: 8 }, (_, i) => ({ name: `site-${String(i + 1)}.example`, count: 800 - i * 50 })),
  top_blocked: [
    { name: 'ads.example', count: 300 },
    { name: 'tracker.example', count: 120 },
  ],
  top_clients: [
    { name: '192.168.1.20', count: 2500 },
    { name: '192.168.1.21', count: 1800 },
    { name: '192.168.1.99', count: 40 },
  ],
});

beforeEach(() => {
  answer.insights = busy();
  answer.calls = 0;
});

afterEach(async () => {
  await cleanup();
});

async function draw(): Promise<Awaited<ReturnType<typeof renderWithProviders>>> {
  return renderWithProviders(
    <TooltipProvider>
      <InsightsCard />
    </TooltipProvider>,
  );
}

test('the window, when it was read and how often, the totals, and the chart', async () => {
  const screen = await draw();
  await expect.element(screen.getByText('What it’s seeing, last 24 hours')).toBeVisible();
  await expect.element(screen.getByText(/^Updated \d+ s ago · next in \d+ s$/)).toBeVisible();
  await expect.element(screen.getByText('6,000', { exact: true })).toBeVisible();
  await expect.element(screen.getByText('540 · 9.0%')).toBeVisible();
  await expect
    .element(screen.getByRole('img', { name: 'Lookups and blocked lookups per hour over the last 24 hours' }))
    .toBeInTheDocument();
  expect(answer.calls).toBe(1);
});

test('the top lists: names and counts, devices by the router’s names, five until asked for the rest', async () => {
  const screen = await draw();
  const asked = screen.getByRole('region', { name: 'Asked for most' });
  await expect.element(asked.getByText('site-1.example')).toBeVisible();
  await expect.element(asked.getByText('site-5.example')).toBeVisible();
  await expect.element(asked.getByText('site-6.example')).not.toBeInTheDocument();
  const more = asked.getByRole('button', { name: 'Show all 8' });
  await expect.element(more).toHaveAttribute('aria-expanded', 'false');
  await more.click();
  await expect.element(asked.getByText('site-8.example')).toBeVisible();
  await asked.getByRole('button', { name: 'Show the first five' }).click();
  await expect.element(asked.getByText('site-8.example')).not.toBeInTheDocument();

  const blocked = screen.getByRole('region', { name: 'Blocked most' });
  await expect.element(blocked.getByText('ads.example')).toBeVisible();
  await expect.element(blocked.getByRole('button', { name: /Show all/ })).not.toBeInTheDocument();

  const devices = screen.getByRole('region', { name: 'Devices asking most' });
  await expect.element(devices.getByText('sams-iphone')).toBeVisible();
  await expect.element(devices.getByText('192.168.1.20')).toBeVisible();
  await expect.element(devices.getByText('living-room-tv')).toBeVisible();
  // an address the router has no name for
  await expect.element(devices.getByText('Unnamed device')).toBeVisible();
  await expect.element(devices.getByText('192.168.1.99')).toBeVisible();
});

test('nothing blocked yet: says where its blocklists are chosen', async () => {
  answer.insights = { ...busy(), top_blocked: [], total_blocked: 0 };
  const screen = await draw();
  await expect.element(screen.getByText('Nothing blocked yet. Its blocklists are chosen in its web interface.')).toBeVisible();
});

test('not giving its figures yet (starting): says so, and that it tries again', async () => {
  answer.insights = { running: true, error: 'stats' };
  const screen = await draw();
  await expect.element(screen.getByText('What it’s seeing', { exact: true })).toBeVisible();
  await expect.element(screen.getByText(/It isn’t giving its figures yet/)).toBeVisible();
  await expect.element(screen.getByRole('region', { name: 'Asked for most' })).not.toBeInTheDocument();
});
