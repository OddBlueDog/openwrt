// The sheet that adds a group of devices, against the pretend router's busy
// household: a time added from a preset and one removed go through the
// form's list, the save is held back until there's a name and a device, and
// a save that fails keeps the sheet open with the failure while one that
// goes through hands the changes over once.
import 'virtual:milkflint-themes.css';
import '@/styles.css';
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup } from 'vitest-browser-react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { type DcData, loadDeviceControl } from '@/features/device-control/api';
import { PersonSheet, type SheetData } from '@/features/device-control/person-sheet';
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

const sheetData = (d: DcData): SheetData => ({
  cfg: d.fw.cfg,
  firewall: d.fw.sections,
  milkflint: d.milkflint,
  people: d.people,
  devices: d.devices,
  guestZones: d.guestZones,
  adguard: 'none',
  intercept: d.intercept,
});

async function draw(
  onSubmit: (changes: Change[]) => Promise<string | undefined>,
  onClose = vi.fn(),
): Promise<Awaited<ReturnType<typeof renderWithProviders>>> {
  const data = await loadDeviceControl();
  const names = new Map(data.devices.map((d) => [d.mac, d.name]));
  return renderWithProviders(
    <TooltipProvider>
      <PersonSheet
        data={sheetData(data)}
        entry={undefined}
        kind="person"
        me={undefined}
        deviceName={(mac) => names.get(mac)}
        onClose={onClose}
        onSubmit={onSubmit}
      />
    </TooltipProvider>,
  );
}

async function fillIn(screen: Awaited<ReturnType<typeof draw>>): Promise<void> {
  await screen.getByLabelText('Group name').fill('Kids');
  await screen.getByRole('checkbox').first().click();
  await screen.getByRole('group', { name: 'Add a time' }).getByRole('button').first().click();
}

test('times come and go through the form’s list; Add waits for a name, a device and a time', async () => {
  const screen = await draw(vi.fn<(changes: Change[]) => Promise<string | undefined>>());
  const add = screen.getByRole('button', { name: 'Add', exact: true }).last();
  await expect.element(add).toBeDisabled();
  await screen.getByLabelText('Group name').fill('Kids');
  await screen.getByRole('checkbox').first().click();
  await expect.element(screen.getByText('Add a time, or choose Always or Only when paused.')).toBeVisible();
  const presets = screen.getByRole('group', { name: 'Add a time' }).getByRole('button');
  await presets.first().click();
  await presets.nth(1).click();
  const removes = screen.getByRole('button', { name: /^Remove / });
  await expect.poll(() => removes.elements().length).toBe(2);
  await removes.first().click();
  await expect.poll(() => removes.elements().length).toBe(1);
  await expect.element(add).toBeEnabled();
});

test('a save that fails keeps the sheet open with the failure', async () => {
  const onClose = vi.fn();
  const onSubmit = vi.fn<(changes: Change[]) => Promise<string | undefined>>(() =>
    Promise.resolve('The router is not responding'),
  );
  const screen = await draw(onSubmit, onClose);
  await fillIn(screen);
  await screen.getByRole('button', { name: 'Add', exact: true }).last().click();
  await expect.element(screen.getByText('The router is not responding')).toBeVisible();
  expect(onSubmit).toHaveBeenCalledTimes(1);
  expect(onSubmit.mock.calls[0]?.[0].length).toBeGreaterThan(0);
  expect(onClose).not.toHaveBeenCalled();
});

test('a save that goes through hands the changes over once', async () => {
  const onSubmit = vi.fn<(changes: Change[]) => Promise<string | undefined>>(() => Promise.resolve(undefined));
  const screen = await draw(onSubmit);
  await fillIn(screen);
  await screen.getByRole('button', { name: 'Add', exact: true }).last().click();
  await vi.waitFor(() => {
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
  expect(screen.getByText('The router is not responding').elements()).toHaveLength(0);
});
