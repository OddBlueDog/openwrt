// The port forward sheet against the pretend router's busy household: an
// empty field isn't marked wrong (Save stays off and the footer says what's
// still needed), a preset fills the form, a typed port shows its error, and
// a save that fails keeps the sheet open with the failure while one that
// goes through closes it.
import 'virtual:milkflint-themes.css';
import '@/styles.css';
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup } from 'vitest-browser-react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { type FirewallData, loadFirewall } from '@/features/firewall/api';
import { ForwardSheet } from '@/features/port-forwards/forward-sheet';
import type { Change } from '@/lib/api/uci';
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
});

async function draw(
  data: FirewallData,
  onSubmit: (changes: Change[]) => Promise<string | undefined>,
  onClose = vi.fn(),
): Promise<Awaited<ReturnType<typeof renderWithProviders>>> {
  return renderWithProviders(
    <TooltipProvider>
      <ForwardSheet forward={undefined} data={data} onClose={onClose} onSubmit={onSubmit} />
    </TooltipProvider>,
  );
}

test('empty fields aren’t marked wrong: Save is off and the footer says what’s still needed', async () => {
  const data = await loadFirewall();
  const screen = await draw(data, vi.fn());
  await expect.element(screen.getByText(/^Still needed: the device, a name and the internet port\./)).toBeVisible();
  await expect.element(screen.getByRole('button', { name: 'Open the port' })).toBeDisabled();
  expect(document.querySelectorAll('[aria-invalid="true"]')).toHaveLength(0);
});

test('a preset fills the name and ports; a bad port typed shows its error', async () => {
  const data = await loadFirewall();
  const screen = await draw(data, vi.fn());
  await screen.getByRole('button', { name: 'Minecraft', exact: true }).click();
  await expect.element(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Minecraft');
  await expect.element(screen.getByRole('textbox', { name: 'Internet port' })).toHaveValue('25565');
  await expect.element(screen.getByRole('textbox', { name: 'Device port' })).toHaveValue('25565');
  // the device's port follows the internet port while they're the same
  await screen.getByRole('textbox', { name: 'Internet port' }).fill('70000');
  await expect.element(screen.getByRole('textbox', { name: 'Device port' })).toHaveValue('70000');
  await expect.element(screen.getByText('A port (1–65535) or a range like 8000-8010.').first()).toBeVisible();
});

async function fillIn(screen: Awaited<ReturnType<typeof draw>>): Promise<void> {
  await screen.getByRole('button', { name: 'Minecraft', exact: true }).click();
  await screen.getByRole('button', { name: 'Type an address instead' }).click();
  await screen.getByRole('textbox', { name: 'Device' }).fill('192.168.1.20');
  await expect.element(screen.getByRole('button', { name: 'Open the port' })).toBeEnabled();
}

test('a save that fails keeps the sheet open with the failure', async () => {
  const data = await loadFirewall();
  const onClose = vi.fn();
  const onSubmit = vi.fn<(changes: Change[]) => Promise<string | undefined>>(() =>
    Promise.resolve('The router is not responding'),
  );
  const screen = await draw(data, onSubmit, onClose);
  await fillIn(screen);
  await screen.getByRole('button', { name: 'Open the port' }).click();
  await expect.element(screen.getByText('The router is not responding')).toBeVisible();
  expect(onSubmit).toHaveBeenCalledTimes(1);
  const changes = onSubmit.mock.calls[0]?.[0];
  expect(changes?.[0]).toMatchObject({ op: 'add', config: 'firewall', type: 'redirect' });
  expect(onClose).not.toHaveBeenCalled();
});

test('a save that goes through hands over the changes once', async () => {
  const data = await loadFirewall();
  const onSubmit = vi.fn<(changes: Change[]) => Promise<string | undefined>>(() => Promise.resolve(undefined));
  const screen = await draw(data, onSubmit);
  await fillIn(screen);
  await screen.getByRole('button', { name: 'Open the port' }).click();
  await vi.waitFor(() => {
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
  expect(screen.getByText('The router is not responding').elements()).toHaveLength(0);
});
