// Remote access's devices in a real browser, against the pretend router's
// busy household (three WireGuard peers): listed in the config's order, a
// click on a row or its open button opens the device's sheet, and on a
// phone each device is a button.
import 'virtual:milkflint-themes.css';
import '@/styles.css';
import { afterEach, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { cleanup } from 'vitest-browser-react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { RemoteAccessPage } from '@/features/remote-access/page';
import type * as Ubus from '@/lib/ubus';
import { renderWithProviders } from './render';

vi.mock('@/lib/ubus', async (importOriginal) => {
  const real = await importOriginal<typeof Ubus>();
  return {
    ...real,
    call: async (object: string, method: string, params: Record<string, unknown>, schema: { parse: (v: unknown) => unknown }) => {
      const { answer } = await import('./router');
      const raw = answer('busy', object, method, params);
      if (raw === undefined) throw new real.UbusError(object, method, real.UbusStatus.methodNotFound);
      return schema.parse(raw);
    },
  };
});

afterEach(async () => {
  await cleanup();
  await page.viewport(1400, 1000);
});

async function draw(): Promise<Awaited<ReturnType<typeof renderWithProviders>>> {
  window.location.hash = '#/remote-access';
  const screen = await renderWithProviders(
    <TooltipProvider>
      <RemoteAccessPage />
    </TooltipProvider>,
  );
  await expect.element(screen.getByRole('heading', { name: 'Devices' })).toBeVisible();
  return screen;
}

test('the devices in the config’s order; a row, or its open button, opens the device', async () => {
  const screen = await draw();
  const table = screen.getByRole('table', { name: 'Devices' });
  await expect.element(table).toBeVisible();
  const names = [...table.element().querySelectorAll('tbody tr')].map((tr) => tr.querySelector('td')?.textContent);
  expect(names).toEqual(['Sam’s iPhone 15 Pro Max', 'Work laptop', 'Alex’s Pixel']);
  // no heading sorts: a few devices, as they were added
  expect(table.getByRole('columnheader').getByRole('button').elements()).toHaveLength(0);

  await table.getByRole('cell', { name: 'Work laptop' }).click();
  await expect.element(page.getByRole('dialog', { name: 'Work laptop' })).toBeVisible();
  await userEvent.keyboard('{Escape}');
  await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
  await screen.getByRole('button', { name: 'Open Alex’s Pixel' }).click();
  await expect.element(page.getByRole('dialog', { name: 'Alex’s Pixel' })).toBeVisible();
});

test('on a phone, each device is a button that opens it', async () => {
  await page.viewport(390, 900);
  const screen = await draw();
  expect(screen.getByRole('table').elements()).toHaveLength(0);
  const list = screen.getByRole('list', { name: 'Devices' });
  expect(list.getByRole('button').elements()).toHaveLength(3);
  await list.getByRole('button', { name: /^Work laptop/ }).click();
  await expect.element(page.getByRole('dialog', { name: 'Work laptop' })).toBeVisible();
});
