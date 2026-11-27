// The Processes sheet in a real browser, against a pretend router whose
// processes move on at each reading: busiest first once there are two
// readings, the idle ones by memory; the headings sort and only turn round;
// a row opens to its details; a search with no match says so.
import 'virtual:milkflint-themes.css';
import '@/styles.css';
import { afterEach, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';
import { cleanup } from 'vitest-browser-react';
import { ProcessesSheet } from '@/components/processes/processes-sheet';
import type * as Ubus from '@/lib/ubus';
import { renderWithProviders } from './render';

const reads = vi.hoisted(() => ({ n: 0 }));

vi.mock('@/lib/ubus', async (importOriginal) => {
  const real = await importOriginal<typeof Ubus>();
  return {
    ...real,
    call: (object: string, method: string, _params: unknown, schema: { parse: (v: unknown) => unknown }) => {
      if (`${object} ${method}` !== 'milkflint processes')
        return Promise.reject(new real.UbusError(object, method, real.UbusStatus.methodNotFound));
      // each second on four cores: hostapd a tenth of it, ksoftirqd/1 a twentieth, the rest idle
      const n = reads.n++;
      const proc = (pid: number, name: string, rss: number, ticks: number, kernel = false): unknown => ({
        pid,
        ppid: kernel ? 2 : 1,
        name,
        state: 'S',
        ticks,
        threads: 1,
        start: 100,
        kernel,
        user: kernel ? 'root' : name === 'hostapd' ? 'network' : 'root',
        rss,
        cmd: kernel ? '' : `/usr/sbin/${name}`,
      });
      return Promise.resolve(
        schema.parse({
          uptime: 100 + n,
          cpu: { total: 40_000 + 400 * n, idle: 36_000 + 340 * n },
          cores: 4,
          memory: { total: 512_000_000, available: 300_000_000 },
          processes: [
            proc(1, 'procd', 1_000_000, 10),
            proc(100, 'hostapd', 4_000_000, 500 + 40 * n),
            proc(101, 'dnsmasq', 9_000_000, 50),
            proc(2, 'kthreadd', 0, 0, true),
            proc(23, 'ksoftirqd/1', 0, 100 + 20 * n, true),
          ],
        }),
      );
    },
  };
});

afterEach(async () => {
  reads.n = 0;
  await cleanup();
});

const names = (): string[] =>
  [...document.querySelectorAll('table[aria-label="Processes"] tbody tr')].map(
    (tr) => tr.querySelector('td span.font-medium')?.textContent ?? '',
  );

async function opened(): Promise<void> {
  await renderWithProviders(<ProcessesSheet open onOpenChange={() => undefined} />);
  // CPU use shows from the second reading, a second after the first
  await vi.waitFor(
    () => {
      expect(page.getByRole('cell', { name: '10%' }).elements()).toHaveLength(1);
    },
    { timeout: 3000 },
  );
}

test('busiest first, the idle ones by memory; a heading only turns round', async () => {
  await opened();
  const cpu = page.getByRole('columnheader', { name: 'CPU' });
  await expect.element(cpu).toHaveAttribute('aria-sort', 'descending');
  expect(names()).toEqual(['hostapd', 'ksoftirqd/1', 'dnsmasq', 'procd', 'kthreadd']);
  await cpu.getByRole('button').click();
  await expect.element(cpu).toHaveAttribute('aria-sort', 'ascending');
  await cpu.getByRole('button').click();
  await expect.element(cpu).toHaveAttribute('aria-sort', 'descending');

  // words A to Z first, figures biggest first
  const name = page.getByRole('columnheader', { name: 'Name' });
  await name.getByRole('button').click();
  await expect.element(name).toHaveAttribute('aria-sort', 'ascending');
  expect(names()).toEqual(['dnsmasq', 'hostapd', 'ksoftirqd/1', 'kthreadd', 'procd']);
  await page.getByRole('columnheader', { name: 'Memory' }).getByRole('button').click();
  expect(names()).toEqual(['dnsmasq', 'hostapd', 'procd', 'ksoftirqd/1', 'kthreadd']);
});

test('a row opens to its details; a search that matches nothing says so', async () => {
  await opened();
  const open = page.getByRole('button', { name: /^dnsmasq/ });
  await open.click();
  await expect.element(open).toHaveAttribute('aria-expanded', 'true');
  const details = document.getElementById(open.element().getAttribute('aria-controls') ?? '');
  expect(details?.textContent).toContain('/usr/sbin/dnsmasq');
  expect(details?.textContent).toContain('Started byprocd (1)');
  await open.click();
  await expect.element(open).toHaveAttribute('aria-expanded', 'false');
  expect(open.element().getAttribute('aria-controls')).toBeNull();

  await page.getByRole('searchbox', { name: /Find a process/ }).fill('nothing-like-this');
  await expect.element(page.getByText('No process matches.')).toBeVisible();
});
