// A device's side sheet against the pretend router: the live speed only where it means something (not for a
// wired device in access point mode, not for an offline one), and the same first-seen line as Data usage.
import 'virtual:milkflint-themes.css';
import '@/styles.css';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup } from 'vitest-browser-react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { DeviceSheet } from '@/features/clients/device-sheet';
import { clientsQueries } from '@/features/clients/queries';
import type { ClientsData, Device } from '@/features/clients/api';
import type * as Ubus from '@/lib/ubus';
import { NOW } from './fixtures';
import { growth, seenRecord } from './router';
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

const MAC = 'aa:00:00:00:01:20';
const data: ClientsData = { devices: [], routerIp: '192.168.1.1', prefix: 24 };
const wired: Device = {
  mac: MAC,
  name: 'nas',
  ip: '192.168.1.50',
  wifi: undefined,
  online: true,
  leaseExpires: undefined,
  reservation: undefined,
};
const phone: Device = {
  ...wired,
  mac: 'aa:bb:cc:00:01:02',
  name: 'phone',
  wifi: { band: '5 GHz', ssid: 'Home', signal: -50, snr: 40, rate: 500_000_000, connected: 100 },
};

beforeEach(() => {
  growth.on = true;
  growth.n = 0;
});

afterEach(async () => {
  growth.on = false;
  seenRecord.devices = {};
  await cleanup();
});

async function open(device: Device, links: boolean): Promise<Awaited<ReturnType<typeof renderWithProviders>>> {
  return renderWithProviders(
    <TooltipProvider>
      <DeviceSheet device={device} data={data} links={links} onClose={() => undefined} onSave={() => undefined} />
    </TooltipProvider>,
  );
}

test('a wired device on a router draws its live speed', async () => {
  await open(wired, true);
  await vi.waitFor(() => {
    expect(document.querySelector('[data-device-live]')).not.toBeNull();
  });
});

test('access point mode: a wired device has no live speed (bridged traffic is not counted)', async () => {
  const screen = await open(wired, false);
  await expect.element(screen.getByText('Wired')).toBeVisible();
  expect(document.querySelector('[data-device-live]')).toBeNull();
});

test('access point mode: a Wi-Fi device still has its live speed', async () => {
  await open(phone, false);
  await vi.waitFor(() => {
    expect(document.querySelector('[data-device-live]')).not.toBeNull();
  });
});

test('an offline device has no live speed', async () => {
  const screen = await open({ ...wired, online: false }, true);
  await expect.element(screen.getByText('Offline')).toBeVisible();
  expect(document.querySelector('[data-device-live]')).toBeNull();
});

test('the sheet shows the first-seen line, with the record start while the record is young', async () => {
  seenRecord.since = NOW - 3 * 86400;
  seenRecord.devices = { [MAC]: [NOW - 86400, NOW] };
  const screen = await open(wired, true);
  await expect.element(screen.getByText(/^First seen .*\(records began .*\)$/)).toBeVisible();
  seenRecord.since = NOW - 40 * 86400;
});

test('a device no Device control rule names: its read holds null, not an error, and the sheet says what it may do', async () => {
  const screen = await open(wired, true);
  await expect.element(screen.getByText('When it may use the internet')).toBeVisible();
  await vi.waitFor(() => {
    expect(screen.client.getQueryState(clientsQueries.control(MAC).queryKey)?.status).toBe('success');
  });
  expect(screen.client.getQueryData(clientsQueries.control(MAC).queryKey)).toBeNull();
});
