// A device's live speed: Wi-Fi from its station counters every 2 s, wired from
// its connections' byte sums, against the pretend router (which grows both).
import 'virtual:milkflint-themes.css';
import '@/styles.css';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup } from 'vitest-browser-react';
import { DeviceLive } from '@/components/device-live';
import type * as Ubus from '@/lib/ubus';
import { growth } from './router';
import { renderWithProviders } from './render';

const sent = vi.hoisted(() => [] as string[]);

vi.mock('@/lib/ubus', async (importOriginal) => {
  const real = await importOriginal<typeof Ubus>();
  return {
    ...real,
    call: async (object: string, method: string, params: Record<string, unknown>, schema: { parse: (v: unknown) => unknown }) => {
      sent.push(`${object} ${method}`);
      const { answer } = await import('./router');
      const raw = answer('busy', object, method, params);
      if (raw === undefined) throw new real.UbusError(object, method, real.UbusStatus.methodNotFound);
      return schema.parse(raw);
    },
  };
});

const PHONE = 'aa:bb:cc:00:00:01';
const MAC = 'aa:00:00:00:01:20';
const WIRED = "Through the router: traffic to other devices on your network isn't counted.";

beforeEach(async () => {
  growth.on = true;
  growth.n = 0;
  growth.macOnWifi = false;
  growth.apDown = false;
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  // the last test's unmounted sampler may still be finishing a read
  await vi.advanceTimersByTimeAsync(200);
  sent.length = 0;
});

afterEach(async () => {
  vi.useRealTimers();
  growth.on = false;
  await cleanup();
  sent.length = 0;
});

test('a link the caller knows to be wired skips the Wi-Fi walk', async () => {
  await renderWithProviders(<DeviceLive mac={MAC} link="wired" />);
  await vi.advanceTimersByTimeAsync(5100);
  await vi.advanceTimersByTimeAsync(5100);
  await vi.waitFor(() => {
    expect(sent).toContain('milkflint.connections list');
  });
  expect(sent.join(', ')).not.toContain('assoclist');
});

test('a Wi-Fi device shows its speed in Mbit/s from its station counters, and no wired line', async () => {
  const screen = await renderWithProviders(<DeviceLive mac={PHONE} />);
  await vi.advanceTimersByTimeAsync(2100);
  await vi.advanceTimersByTimeAsync(2100);
  await expect.element(screen.getByText(/download [\d.]+ Mbit\/s/)).toBeVisible();
  expect(document.body.textContent).not.toContain('Through the router');
});

test('a wired device shows its speed and the wired line', async () => {
  const screen = await renderWithProviders(<DeviceLive mac={MAC} />);
  await vi.advanceTimersByTimeAsync(5100);
  await vi.advanceTimersByTimeAsync(5100);
  await expect.element(screen.getByText(/download [\d.]+ [kM]bit\/s/)).toBeVisible();
  await expect.element(screen.getByText(WIRED)).toBeVisible();
});

test('after unmount nothing more is asked', async () => {
  const screen = await renderWithProviders(<DeviceLive mac={PHONE} />);
  await vi.advanceTimersByTimeAsync(2100);
  await screen.unmount();
  const before = sent.length;
  await vi.advanceTimersByTimeAsync(20_000);
  expect(sent.length).toBe(before);
});

test('a device that moves from Wi-Fi to wired restarts: no spike, the wired line follows', async () => {
  growth.macOnWifi = true;
  const screen = await renderWithProviders(<DeviceLive mac={MAC} />);
  await vi.advanceTimersByTimeAsync(2100);
  await vi.advanceTimersByTimeAsync(2100);
  await expect.element(screen.getByText(/download [\d.]+ Mbit\/s/)).toBeVisible();
  expect(document.body.textContent).not.toContain('Through the router');
  // it plugs in: its Wi-Fi counters (billions) give way to its connections' sums (millions)
  growth.macOnWifi = false;
  await vi.advanceTimersByTimeAsync(2100);
  await expect.element(screen.getByText(WIRED)).toBeVisible();
  expect(document.body.textContent).toContain('download …');
  await vi.advanceTimersByTimeAsync(5100);
  await expect.element(screen.getByText(/download [\d.]+ [kM]bit\/s/)).toBeVisible();
  expect(document.body.textContent).not.toMatch(/Gbit/);
});

test('a different device starts over: the last one’s figure and baseline are gone', async () => {
  const screen = await renderWithProviders(<DeviceLive mac={PHONE} />);
  await vi.advanceTimersByTimeAsync(2100);
  await vi.advanceTimersByTimeAsync(2100);
  await expect.element(screen.getByText(/download [\d.]+ Mbit\/s/)).toBeVisible();
  await screen.rerender(<DeviceLive mac={MAC} />);
  expect(document.body.textContent).toContain('download …');
  expect(document.body.textContent).not.toMatch(/Mbit\/s/);
});

test('an access point that cannot be read leaves the figure unknown, not wired', async () => {
  growth.apDown = true;
  const screen = await renderWithProviders(<DeviceLive mac={PHONE} />);
  await vi.advanceTimersByTimeAsync(2100);
  await vi.advanceTimersByTimeAsync(2100);
  expect(document.body.textContent).not.toContain('Through the router');
  await expect.element(screen.getByText(/download …/)).toBeVisible();
});

test('a device with no known address is unknown, not 0', async () => {
  const screen = await renderWithProviders(<DeviceLive mac="aa:00:00:00:09:99" />);
  await vi.advanceTimersByTimeAsync(5100);
  await vi.advanceTimersByTimeAsync(5100);
  await expect.element(screen.getByText(/download …/)).toBeVisible();
});

test('the wireless status and station list are not re-read for every sample', async () => {
  await renderWithProviders(<DeviceLive mac={PHONE} />);
  await vi.advanceTimersByTimeAsync(2100);
  await vi.advanceTimersByTimeAsync(2100);
  await vi.advanceTimersByTimeAsync(2100);
  expect(sent.filter((c) => c === 'luci-rpc getWirelessDevices').length).toBe(1);
});
