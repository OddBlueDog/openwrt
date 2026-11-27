// Operating mode, router picked to become an access point: automatic needs
// nothing more; a fixed address checks what's typed and keeps the switch off
// until it's right; the switch asks first.
import 'virtual:milkflint-themes.css';
import '@/styles.css';
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup } from 'vitest-browser-react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ModePage } from '@/features/mode/page';
import type * as Ubus from '@/lib/ubus';
import { renderWithProviders } from './render';

vi.mock('@/lib/ubus', async (importOriginal) => {
  const real = await importOriginal<typeof Ubus>();
  return {
    ...real,
    call: (object: string, method: string, _params: Record<string, unknown>, schema: { parse: (v: unknown) => unknown }) => {
      if (`${object}.${method}` !== 'milkflint.mode.status') return Promise.reject(new real.UbusError(object, method, 3));
      return Promise.resolve(
        schema.parse({
          now: 1_800_000_000,
          mode: 'router',
          switching: false,
          wan_port: 'eth1',
          lan: { proto: 'static', ipaddr: '192.168.1.1', netmask: '255.255.255.0', dns: [] },
          uplink: { up: true, ipaddr: '192.168.0.23', prefix: 24, gateway: '192.168.0.1' },
          bridge_offload: false,
          bridge_offload_available: true,
        }),
      );
    },
  };
});

afterEach(async () => {
  await cleanup();
});

test('a fixed address: checked as it’s typed, the switch off until it’s right, then asks first', async () => {
  const screen = await renderWithProviders(
    <TooltipProvider>
      <ModePage />
    </TooltipProvider>,
  );
  await screen.getByRole('radio', { name: /Access point/ }).click();
  const go = screen.getByRole('button', { name: 'Switch to access point mode' });
  await expect.element(go).toBeEnabled();

  await screen.getByRole('radio', { name: /A fixed address/ }).click();
  await expect.element(screen.getByRole('textbox', { name: 'Main router' })).toHaveValue('192.168.0.1');
  await expect.element(screen.getByText('Enter an IPv4 address on your main router’s network, e.g. 192.168.0.2.')).toBeVisible();
  await expect.element(go).toBeDisabled();

  await screen.getByRole('textbox', { name: 'IP address' }).fill('192.168.0.1');
  await expect.element(screen.getByText('That’s the address you picked for MilkFlint.')).toBeVisible();
  await screen.getByRole('textbox', { name: 'IP address' }).fill('192.168.0.2');
  await expect.element(go).toBeEnabled();
  await go.click();
  await expect.element(screen.getByRole('heading', { name: 'Switch to access point mode?' })).toBeVisible();
  await expect.element(screen.getByText(/answers at http:\/\/192\.168\.0\.2/)).toBeVisible();
});
