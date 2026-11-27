// UPnP's open ports in a real browser, against the pretend router's busy
// household with miniupnpd on and three ports opened: listed as the router
// lists them, a port sorting as a number, a device by its name (the DHCP
// lease's) else its address, and those that close only on a restart last;
// with UPnP off and nothing open, the note says so; a switch changed shows
// the save bar, and Discard puts it back.
import 'virtual:milkflint-themes.css';
import '@/styles.css';
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup } from 'vitest-browser-react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { UpnpPage } from '@/features/upnp/page';
import type * as Ubus from '@/lib/ubus';
import { renderWithProviders } from './render';

const upnp = vi.hoisted(() => ({ on: true }));

vi.mock('@/lib/ubus', async (importOriginal) => {
  const real = await importOriginal<typeof Ubus>();
  return {
    ...real,
    call: async (object: string, method: string, params: Record<string, unknown>, schema: { parse: (v: unknown) => unknown }) => {
      const { answer } = await import('./router');
      const map = (proto: string, ext: number, addr: string, remaining: number | null, description: string): unknown => ({
        proto,
        ext_port: ext,
        int_addr: addr,
        int_port: ext,
        remaining,
        description,
      });
      const raw =
        object === 'uci' && method === 'get' && params['config'] === 'upnpd'
          ? {
              values: {
                config: { '.anonymous': false, '.type': 'upnpd', '.name': 'config', '.index': 0, enabled: upnp.on ? '1' : '0' },
              },
            }
          : `${object} ${method}` === 'milkflint.upnp mappings'
            ? {
                mappings: upnp.on
                  ? [
                      map('UDP', 3074, '192.168.1.20', null, 'Xbox Live'),
                      map('TCP', 443, '192.168.1.77', 1800, ''),
                      map('UDP', 9308, '192.168.1.20', 60, 'PlayStation'),
                    ]
                  : [],
              }
            : answer('busy', object, method, params);
      if (raw === undefined) throw new real.UbusError(object, method, real.UbusStatus.methodNotFound);
      return schema.parse(raw);
    },
  };
});

afterEach(async () => {
  upnp.on = true;
  await cleanup();
});

const TABLE = 'table[aria-label="Ports devices opened"]';
const ports = (): string[] => [...document.querySelectorAll(`${TABLE} tbody tr`)].map((tr) => tr.children[1]?.textContent ?? '');

async function draw(): Promise<Awaited<ReturnType<typeof renderWithProviders>>> {
  window.location.hash = '#/upnp';
  return renderWithProviders(
    <TooltipProvider>
      <UpnpPage />
    </TooltipProvider>,
  );
}

test('the ports as the router lists them; each column sorts', async () => {
  const screen = await draw();
  await expect.element(screen.getByRole('table', { name: 'Ports devices opened' })).toBeVisible();
  expect(ports()).toEqual(['udp 3074', 'tcp 443', 'udp 9308']);
  // the lease's name, else the address
  await expect.element(screen.getByRole('cell', { name: /^studio-mac/ }).first()).toBeVisible();
  await expect.element(screen.getByRole('cell', { name: '192.168.1.77:443' })).toBeVisible();

  const port = screen.getByRole('columnheader', { name: 'Internet port' });
  await port.getByRole('button').click();
  expect(ports()).toEqual(['tcp 443', 'udp 3074', 'udp 9308']);
  const closes = screen.getByRole('columnheader', { name: 'Closes' });
  await closes.getByRole('button').click();
  expect(ports()).toEqual(['udp 9308', 'tcp 443', 'udp 3074']);
  await closes.getByRole('button').click();
  expect(ports()).toEqual(['tcp 443', 'udp 9308', 'udp 3074']);
  await closes.getByRole('button').click();
  expect(ports()).toEqual(['udp 3074', 'tcp 443', 'udp 9308']);
});

test('UPnP off: no table, and the note says why nothing is open', async () => {
  upnp.on = false;
  const screen = await draw();
  await vi.waitFor(() => {
    const card = [...document.querySelectorAll('section')].find((c) => c.textContent.includes('Ports devices opened'));
    expect(card?.textContent).toContain('None: UPnP is off.');
  });
  expect(screen.getByRole('table').elements()).toHaveLength(0);
});

test('toggling a switch shows the save bar; Discard hides it and puts the switch back', async () => {
  const screen = await draw();
  const secure = screen.getByRole('switch', { name: 'Secure mode' });
  await expect.element(secure).toBeChecked();
  expect(screen.getByRole('region', { name: 'Unsaved changes' }).elements()).toHaveLength(0);
  await secure.click();
  await expect.element(screen.getByRole('region', { name: 'Unsaved changes' })).toBeVisible();
  await expect.element(screen.getByText('Without secure mode, any device can open ports to any other device.')).toBeVisible();
  await screen.getByRole('button', { name: 'Discard' }).click();
  await expect.element(secure).toBeChecked();
  expect(screen.getByRole('region', { name: 'Unsaved changes' }).elements()).toHaveLength(0);
});
