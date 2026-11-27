// All devices' list in a real browser: a click on a row (not while a save
// applies) or its edit button opens the device; the headings sort, a
// missing figure last, and a third click goes back to online first; on a
// phone, a card each with its edit button.
import 'virtual:milkflint-themes.css';
import '@/styles.css';
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup } from 'vitest-browser-react';
import type { Device } from '@/features/clients/api';
import { DevicesList } from '@/features/clients/devices-list';
import { renderWithProviders } from './render';

const wifi = (signal: number, rate: number, connected: number): Device['wifi'] => ({
  band: '5 GHz',
  ssid: 'Home',
  signal,
  snr: 40,
  rate,
  connected,
});
const device = (n: number, over: Partial<Device>): Device => ({
  mac: `aa:00:00:00:00:0${String(n)}`,
  name: undefined,
  ip: `192.168.1.${String(n * 10)}`,
  wifi: undefined,
  online: true,
  leaseExpires: undefined,
  reservation: undefined,
  ...over,
});
// as the page gets them: online first, then by address
const devices = [
  device(1, { name: 'lounge-tv', wifi: wifi(-50, 866e6, 3600) }),
  device(2, {}),
  device(3, { name: 'phone', wifi: wifi(-70, 300e6, 60) }),
  device(4, { name: 'old-laptop', online: false }),
];

afterEach(cleanup);

const names = (): string[] =>
  [...document.querySelectorAll('table[aria-label="Devices"] tbody tr')].map(
    (tr) => tr.querySelector('td span.truncate')?.textContent ?? '',
  );

test('a row opens its device, unless a save is applying; the edit button opens it once', async () => {
  const onEdit = vi.fn();
  const screen = await renderWithProviders(
    <div style={{ width: 1000 }}>
      <DevicesList devices={devices} busy={false} onEdit={onEdit} />
    </div>,
  );
  await screen.getByRole('cell', { name: 'Offline' }).click();
  expect(onEdit).toHaveBeenLastCalledWith('aa:00:00:00:00:04');
  await screen.getByRole('button', { name: 'Edit phone' }).click();
  expect(onEdit).toHaveBeenCalledTimes(2);
  expect(onEdit).toHaveBeenLastCalledWith('aa:00:00:00:00:03');

  onEdit.mockClear();
  await screen.rerender(
    <div style={{ width: 1000 }}>
      <DevicesList devices={devices} busy onEdit={onEdit} />
    </div>,
  );
  await screen.getByRole('cell', { name: 'Offline' }).click();
  await expect.element(screen.getByRole('button', { name: 'Edit phone' })).toBeDisabled();
  expect(onEdit).not.toHaveBeenCalled();
});

test('the headings sort, a missing figure last, and a third click is online first again', async () => {
  const screen = await renderWithProviders(
    <div style={{ width: 1000 }}>
      <DevicesList devices={devices} busy={false} onEdit={() => undefined} />
    </div>,
  );
  const signal = screen.getByRole('columnheader', { name: 'Signal' });
  await signal.getByRole('button').click();
  await expect.element(signal).toHaveAttribute('aria-sort', 'descending');
  expect(names()).toEqual(['lounge-tv', 'phone', 'Unnamed device', 'old-laptop']);
  await signal.getByRole('button').click();
  expect(names()).toEqual(['phone', 'lounge-tv', 'Unnamed device', 'old-laptop']);
  await signal.getByRole('button').click();
  expect(names()).toEqual(['lounge-tv', 'Unnamed device', 'phone', 'old-laptop']);

  const name = screen.getByRole('columnheader', { name: 'Device' });
  await name.getByRole('button').click();
  expect(names()).toEqual(['lounge-tv', 'old-laptop', 'phone', 'Unnamed device']);
  await screen.getByRole('columnheader', { name: 'Connection' }).getByRole('button').click();
  expect(names().at(-1)).toBe('old-laptop');
  expect(screen.getByRole('columnheader', { name: 'Edit' }).getByRole('button').elements()).toHaveLength(0);
});

test('on a phone: a card each, with its edit button, and the Sort menu', async () => {
  const onEdit = vi.fn();
  const screen = await renderWithProviders(
    <div style={{ width: 360 }}>
      <DevicesList devices={devices} busy={false} onEdit={onEdit} />
    </div>,
  );
  expect(screen.getByRole('table').elements()).toHaveLength(0);
  expect(screen.getByRole('listitem').elements()).toHaveLength(4);
  await expect.element(screen.getByRole('combobox', { name: 'Sort' })).toHaveTextContent('Online first');
  await screen.getByRole('button', { name: 'Edit lounge-tv' }).click();
  expect(onEdit).toHaveBeenCalledWith('aa:00:00:00:00:01');
});
