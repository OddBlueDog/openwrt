// The Startup page in a real browser, against a pretend router's rc list:
// services in start order (one turned off at boot last), found by name or
// by what they do, a service the router can do without stopped at once,
// one it needs (uhttpd) only after a confirm, and rc.local saved as LuCI
// saves it.
import 'virtual:milkflint-themes.css';
import '@/styles.css';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup } from 'vitest-browser-react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { StartupPage } from '@/features/startup/page';
import type * as Ubus from '@/lib/ubus';
import { renderWithProviders } from './render';

const router = vi.hoisted(() => ({
  rcLocal: '# Put your custom commands here\n\nexit 0\n',
  runs: [] as string[],
  writes: [] as string[],
}));

vi.mock('@/lib/ubus', async (importOriginal) => {
  const real = await importOriginal<typeof Ubus>();
  return {
    ...real,
    call: (object: string, method: string, params: Record<string, unknown>, schema: { parse: (v: unknown) => unknown }) => {
      const raw =
        `${object} ${method}` === 'rc list'
          ? {
              uhttpd: { start: 50, enabled: true, running: true },
              boot: { start: 10, stop: 90, enabled: true },
              'milkflint-vpn': { enabled: false },
              nlbwmon: { start: 60, enabled: true, running: true },
              dnsmasq: { start: 19, enabled: true, running: true },
            }
          : `${object} ${method}` === 'file read' && params['path'] === '/etc/rc.local'
            ? { data: router.rcLocal }
            : undefined;
      if (raw === undefined) return Promise.reject(new real.UbusError(object, method, real.UbusStatus.methodNotFound));
      return Promise.resolve(schema.parse(raw));
    },
    exec: (object: string, method: string, params: Record<string, unknown> = {}) => {
      if (`${object} ${method}` === 'rc init') router.runs.push(`${String(params['name'])} ${String(params['action'])}`);
      if (`${object} ${method}` === 'file write') {
        router.rcLocal = String(params['data']);
        router.writes.push(router.rcLocal);
      }
      return Promise.resolve();
    },
  };
});

beforeEach(() => {
  router.rcLocal = '# Put your custom commands here\n\nexit 0\n';
  router.runs = [];
  router.writes = [];
});

afterEach(async () => {
  await cleanup();
});

async function draw(sub = ''): Promise<Awaited<ReturnType<typeof renderWithProviders>>> {
  window.location.hash = `#/startup${sub}`;
  return renderWithProviders(
    <TooltipProvider>
      <StartupPage />
    </TooltipProvider>,
  );
}

const names = (): string[] =>
  [...document.querySelectorAll('table[aria-label="Services"] tbody tr')].map(
    (tr) => tr.children[1]?.querySelector('.font-medium')?.textContent ?? '',
  );

test('in start order, the one off at boot last; found by what it does', async () => {
  const screen = await draw();
  await expect.element(screen.getByRole('table', { name: 'Services' })).toBeVisible();
  expect(names()).toEqual(['boot', 'dnsmasq', 'uhttpd', 'nlbwmon', 'milkflint-vpn']);
  await screen.getByRole('searchbox', { name: 'Find a service' }).fill('DHCP');
  await expect.poll(names).toEqual(['dnsmasq']);
});

test('stopping one the router can do without happens at once; uhttpd asks first', async () => {
  const screen = await draw();
  await screen.getByRole('button', { name: 'Stop nlbwmon' }).click();
  await expect.poll(() => router.runs).toEqual(['nlbwmon stop']);

  await screen.getByRole('button', { name: 'Stop uhttpd' }).click();
  const dialog = screen.getByRole('dialog');
  await expect.element(dialog.getByText(/This page and LuCI stop answering/)).toBeVisible();
  expect(router.runs).toEqual(['nlbwmon stop']);
  await dialog.getByRole('button', { name: 'Stop' }).click();
  await expect.poll(() => router.runs).toEqual(['nlbwmon stop', 'uhttpd stop']);
});

test('rc.local: saved with Unix line ends and one newline at the end', async () => {
  const screen = await draw('/local');
  const field = screen.getByRole('textbox', { name: '/etc/rc.local' });
  await expect.element(field).toHaveValue(router.rcLocal);
  await field.fill('echo hello > /tmp/hello\r\nexit 0\n\n\n');
  await screen.getByRole('button', { name: 'Save & apply' }).click();
  await expect.poll(() => router.writes).toEqual(['echo hello > /tmp/hello\nexit 0\n']);
});
